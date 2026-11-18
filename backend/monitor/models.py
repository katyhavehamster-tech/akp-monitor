"""Модель даних AKP Monitor.

Структура повторює синтетичний набір організаторів (dictionary.md), але
узагальнена: кілька органів, кілька програм, квартальні звітні періоди.
Персональних даних немає — користувач описаний лише роллю, підрозділом і посадою.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import uuid
from datetime import date, timedelta
from datetime import timezone as dt_timezone
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.utils import timezone


class Role(models.TextChoices):
    KOORD = "KOORD", "Уповноважений (адміністратор програми)"
    ADMIN = "ADMIN", "Технічний адміністратор"
    KER = "KER", "Керівник"
    VYK = "VYK", "Виконавець"
    ANAL = "ANAL", "Аналітик"


class Organ(models.Model):
    name = models.CharField("Назва органу", max_length=300)

    def __str__(self):
        return self.name


class Unit(models.Model):
    """Структурний підрозділ (P01–P14)."""
    code = models.CharField(max_length=10, unique=True)
    organ = models.ForeignKey(Organ, on_delete=models.CASCADE, related_name="units")
    name = models.CharField(max_length=300)
    type = models.CharField(max_length=50, blank=True)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} {self.name}"


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    code = models.CharField("Код користувача", max_length=10, unique=True)
    full_name = models.CharField("Власне імʼя ПРІЗВИЩЕ (ПІБ)", max_length=200, blank=True, default="")
    role = models.CharField(max_length=10, choices=Role.choices)
    unit = models.ForeignKey(Unit, null=True, blank=True, on_delete=models.SET_NULL)
    position = models.CharField("Посада", max_length=300)

    def __str__(self):
        return f"{self.code} ({self.role})"


class Program(models.Model):
    code = models.CharField(max_length=50, unique=True)
    organ = models.ForeignKey(Organ, on_delete=models.CASCADE, related_name="programs")
    name = models.CharField(max_length=500)
    period_start = models.DateField()
    period_end = models.DateField()
    approved = models.CharField(max_length=300, blank=True)
    nazk_status = models.CharField(max_length=300, blank=True)
    restricted_info = models.BooleanField("Містить інформацію з обмеженим доступом", default=False)
    coordinator_unit = models.ForeignKey(Unit, null=True, on_delete=models.SET_NULL, related_name="+")
    goals = models.TextField(blank=True)
    note = models.TextField(blank=True)

    def __str__(self):
        return self.name


class Section(models.Model):
    program = models.ForeignKey(Program, on_delete=models.CASCADE, related_name="sections")
    code = models.CharField(max_length=5)  # R1..R3
    number = models.PositiveSmallIntegerField()
    portal_name = models.CharField(max_length=500)

    class Meta:
        ordering = ["number"]
        unique_together = [("program", "code")]

    def __str__(self):
        return f"{self.number}. {self.portal_name}"


class Risk(models.Model):
    LEVELS = ["низький", "середній", "високий", "критичний"]
    code = models.CharField(max_length=10, unique=True)
    program = models.ForeignKey(Program, on_delete=models.CASCADE, related_name="risks")
    process = models.CharField("Функція, процес", max_length=300)
    name = models.CharField(max_length=500)
    content = models.TextField(blank=True)
    sources = models.TextField(blank=True)
    existing_controls = models.TextField(blank=True)
    probability = models.PositiveSmallIntegerField()
    consequences = models.PositiveSmallIntegerField()
    owner_unit = models.ForeignKey(Unit, null=True, on_delete=models.SET_NULL)
    indicator = models.CharField("Індикатор стану ризику", max_length=500)
    indicator_unit = models.CharField(max_length=20, blank=True)
    direction = models.CharField(max_length=10, help_text="менше / більше")
    baseline = models.FloatField()
    target = models.FloatField()
    target_date = models.DateField(null=True)

    class Meta:
        ordering = ["code"]

    @property
    def score(self):
        return self.probability * self.consequences

    @property
    def level(self):
        """Рівень ризику за Методологією НАЗК № 830/21."""
        b = self.score
        if b <= 2:
            return "низький"
        if b <= 4:
            return "середній"
        if b <= 9:
            return "високий"
        return "критичний"

    def value_on(self, d: date):
        m = self.measurements.filter(date__lte=d).order_by("-date").first()
        return m.value if m else None

    def progress_on(self, d: date):
        """Частка шляху від базового до цільового значення (0..1+)."""
        v = self.value_on(d)
        if v is None:
            return None
        gap = self.target - self.baseline
        return (v - self.baseline) / gap if gap else 1.0

    def __str__(self):
        return f"{self.code} {self.name}"


class RiskMeasurement(models.Model):
    risk = models.ForeignKey(Risk, on_delete=models.CASCADE, related_name="measurements")
    date = models.DateField()
    value = models.FloatField()
    source = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["risk", "date"]
        unique_together = [("risk", "date")]


class Measure(models.Model):
    STROK_TYPES = [("data", "До дати"), ("postiino", "Постійно"), ("periodychno", "Періодично")]
    code = models.CharField(max_length=10, unique=True)
    program = models.ForeignKey(Program, on_delete=models.CASCADE, related_name="measures")
    section = models.ForeignKey(Section, on_delete=models.PROTECT, related_name="measures")
    number = models.PositiveSmallIntegerField("№ у розділі")
    content = models.TextField("Зміст заходу")
    risk = models.ForeignKey(Risk, null=True, blank=True, on_delete=models.PROTECT, related_name="measures")
    responsible_unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="measures")
    co_units = models.ManyToManyField(Unit, blank=True, related_name="co_measures")
    strok_text = models.CharField("Строк за програмою", max_length=100)
    strok_type = models.CharField(max_length=15, choices=STROK_TYPES)
    strok_date = models.DateField(null=True, blank=True)
    indicator = models.CharField("Індикатор виконання", max_length=500)
    indicator_unit = models.CharField(max_length=20, blank=True)
    indicator_target = models.FloatField(null=True, blank=True)
    required_evidence = models.CharField("Потрібні підтвердні матеріали", max_length=500, blank=True)
    resources = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["section__number", "number"]

    def __str__(self):
        return f"{self.code} {self.content[:60]}"

    @property
    def current_deadline(self):
        """Внутрішній робочий строк з урахуванням рішень про перенесення.
        Строк у затвердженій програмі не змінюється."""
        last = self.deadline_changes.order_by("-decision_date").first()
        return last.new_date if last else self.strok_date


class DeadlineChange(models.Model):
    measure = models.ForeignKey(Measure, on_delete=models.CASCADE, related_name="deadline_changes")
    decision_date = models.DateField()
    old_date = models.DateField()
    new_date = models.DateField()
    reason = models.CharField(max_length=500)
    approved_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ["decision_date"]


class ReportingPeriod(models.Model):
    """Квартальний звітний період. Виконавці вносять дані 4 рази на рік
    протягом вікна з N днів (за замовчуванням 5) після завершення кварталу."""
    code = models.CharField(max_length=10, unique=True)  # 2026-Q2
    year = models.PositiveSmallIntegerField()
    quarter = models.PositiveSmallIntegerField()
    start = models.DateField()
    end = models.DateField()
    window_start = models.DateField("Початок вікна внесення")
    window_end = models.DateField("Кінець вікна внесення")
    force_open = models.BooleanField("Відкрито позачергово", default=False)

    class Meta:
        ordering = ["year", "quarter"]

    def __str__(self):
        return self.code

    @property
    def half(self):
        return 1 if self.quarter <= 2 else 2

    @property
    def half_end(self):
        return date(self.year, 6, 30) if self.half == 1 else date(self.year, 12, 31)

    def is_open(self, today: date | None = None):
        today = today or SystemSettings.today()
        return self.force_open or self.window_start <= today <= self.window_end

    @staticmethod
    def make(year: int, quarter: int, window_days: int = 5):
        start = date(year, 3 * (quarter - 1) + 1, 1)
        end = (date(year + (quarter == 4), (3 * quarter) % 12 + 1, 1) - timedelta(days=1))
        ws = end + timedelta(days=1)
        return ReportingPeriod(code=f"{year}-Q{quarter}", year=year, quarter=quarter, start=start, end=end,
                               window_start=ws, window_end=ws + timedelta(days=window_days - 1))


class Execution(models.Model):
    """Інформація виконавця про стан заходу на кінець кварталу (кумулятивно)."""

    class Status(models.TextChoices):
        VYKONANO = "vykonano", "виконано"
        CHASTKOVO = "chastkovo", "частково виконано"
        NE_VYKONANO = "ne_vykonano", "не виконано"
        V_ROBOTI = "v_roboti", "у роботі"
        NE_ROZPOCHATO = "ne_rozpochato", "не розпочато"

    class Approval(models.TextChoices):
        DRAFT = "draft", "чернетка"
        SUBMITTED = "submitted", "подано на погодження"
        APPROVED = "approved", "погоджено"
        RETURNED = "returned", "повернуто на доопрацювання"

    measure = models.ForeignKey(Measure, on_delete=models.CASCADE, related_name="executions")
    period = models.ForeignKey(ReportingPeriod, on_delete=models.PROTECT, related_name="executions")
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.NE_ROZPOCHATO)
    fact_date = models.DateField(null=True, blank=True)
    result_text = models.TextField("Опис результату або причин невиконання", blank=True)
    indicator_fact = models.FloatField(null=True, blank=True)
    entered_by = models.ForeignKey(Profile, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    entered_at = models.DateTimeField(null=True, blank=True)
    approval = models.CharField(max_length=10, choices=Approval.choices, default=Approval.DRAFT)
    approved_by = models.ForeignKey(Profile, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [("measure", "period")]
        ordering = ["period", "measure"]


def evidence_path(instance, filename):
    base = Path(str(filename or "document")).name
    safe = re.sub(r"[^\w.\-а-яА-ЯіїєґІЇЄҐ]", "_", base)[:80] or "document"
    return f"evidence/{instance.measure.code}/{timezone.now():%Y%m%d%H%M%S}_{safe}"


class Evidence(models.Model):
    """Підтвердний матеріал. Незмінний: після збереження змінити чи видалити не можна,
    можна лише додати нову версію. Цілісність фіксується SHA-256."""
    code = models.CharField(max_length=10, unique=True)
    measure = models.ForeignKey(Measure, on_delete=models.CASCADE, related_name="evidence")
    period = models.ForeignKey(ReportingPeriod, null=True, blank=True, on_delete=models.SET_NULL)
    type = models.CharField(max_length=50)
    title = models.CharField(max_length=500)
    doc_date = models.DateField()
    link = models.URLField(blank=True)
    file = models.FileField(upload_to=evidence_path, blank=True)
    uploaded_at = models.DateTimeField()
    uploaded_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL)
    sha256 = models.CharField(max_length=64)

    class Meta:
        ordering = ["measure", "doc_date"]

    def save(self, *args, **kwargs):
        if self.pk and Evidence.objects.filter(pk=self.pk).exists():
            raise ValidationError("Підтвердний матеріал незмінний: додайте нову версію замість редагування.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Підтвердний матеріал не можна видалити.")

    def verify(self) -> bool | None:
        """Перевірка цілісності файлу (None — файлу немає, лише опис)."""
        if not self.file:
            return None
        h = hashlib.sha256()
        with self.file.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest() == self.sha256


class Comment(models.Model):
    """Коментар або зауваження координатора до заходу."""
    measure = models.ForeignKey(Measure, on_delete=models.CASCADE, related_name="comments")
    period = models.ForeignKey(ReportingPeriod, null=True, blank=True, on_delete=models.SET_NULL)
    author = models.ForeignKey(Profile, null=True, blank=True, on_delete=models.SET_NULL)
    author_code = models.CharField(max_length=20, blank=True, default="")
    author_role_name = models.CharField(max_length=100, blank=True, default="")
    text = models.TextField()
    is_remark = models.BooleanField("Зауваження координатора", default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if self.author_id and self.author:
            if not self.author_code:
                self.author_code = self.author.code
            if not self.author_role_name:
                self.author_role_name = self.author.get_role_display()
        super().save(*args, **kwargs)


class Recommendation(models.Model):
    """Управлінська рекомендація. Генерується явним правилом, рішення ухвалює людина:
    прийнята рекомендація обовʼязково має відповідального і строк."""

    class State(models.TextChoices):
        PROPOSED = "proposed", "запропоновано"
        ACCEPTED = "accepted", "прийнято до виконання"
        REJECTED = "rejected", "відхилено"
        DONE = "done", "виконано"

    key = models.CharField(max_length=100, unique=True)  # стабільний ключ правила+обʼєкта
    rule = models.CharField(max_length=20)
    priority = models.PositiveSmallIntegerField(default=2)  # 1 високий, 2 середній, 3 низький
    title = models.CharField(max_length=500)
    basis = models.JSONField(default=dict)  # на яких даних зроблено висновок
    proposed_action = models.TextField()
    target_unit = models.ForeignKey(Unit, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    state = models.CharField(max_length=10, choices=State.choices, default=State.PROPOSED)
    responsible_unit = models.ForeignKey(Unit, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    due_date = models.DateField(null=True, blank=True)
    decided_by = models.ForeignKey(Profile, null=True, blank=True, on_delete=models.SET_NULL)
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_comment = models.TextField(blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["priority", "key"]


class Survey(models.Model):
    """Результати Google Форми (CSV-експорт). Електронні адреси не зберігаються:
    колонки з поштою відкидаються під час імпорту."""
    title = models.CharField(max_length=300)
    uploaded_at = models.DateTimeField(default=timezone.now)
    uploaded_by = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL)
    questions = models.JSONField(default=list)
    answers = models.JSONField(default=list)  # список рядків-відповідей без часу і пошти
    dropped_columns = models.JSONField(default=list)

    @property
    def n(self):
        return len(self.answers)


class SystemSettings(models.Model):
    """Налаштування, які веде технічний адміністратор."""
    today_override = models.DateField("Робоча (демонстраційна) дата", null=True, blank=True)
    window_days = models.PositiveSmallIntegerField("Тривалість вікна внесення, днів", default=5)
    reminder_days = models.PositiveSmallIntegerField("Нагадувати за, днів", default=14)
    min_survey_group = models.PositiveSmallIntegerField("Мінімальна кількість відповідей для показу", default=5)
    signatory_name = models.CharField("Власне імʼя ПРІЗВИЩЕ уповноваженої особи (для Word-звітів)", max_length=200, default="Олександр КОВАЛЕНКО", blank=True)
    head_signatory_name = models.CharField("Власне імʼя ПРІЗВИЩЕ керівника органу (для Word-звітів)", max_length=200, default="Валерій СОКОЛОВ", blank=True)

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        changed = False
        if not obj.signatory_name or obj.signatory_name.strip() == "Власне імʼя ПРІЗВИЩЕ":
            obj.signatory_name = "Олександр КОВАЛЕНКО"
            changed = True
        if not obj.head_signatory_name or obj.head_signatory_name.strip() == "Власне імʼя ПРІЗВИЩЕ":
            obj.head_signatory_name = "Валерій СОКОЛОВ"
            changed = True
        if changed:
            obj.save()
        return obj

    @classmethod
    def signatories(cls) -> tuple[str, str]:
        s = cls.get()
        sig1 = (s.signatory_name or "").strip()
        if not sig1 or sig1 == "Власне імʼя ПРІЗВИЩЕ":
            sig1 = "Олександр КОВАЛЕНКО"
        sig2 = (s.head_signatory_name or "").strip()
        if not sig2 or sig2 == "Власне імʼя ПРІЗВИЩЕ":
            sig2 = "Валерій СОКОЛОВ"
        return sig1, sig2

    @classmethod
    def today(cls) -> date:
        s = cls.get()
        return s.today_override or timezone.localdate()


class AuditLog(models.Model):
    """Журнал дій. Записи утворюють ланцюжок хешів: кожен містить хеш попереднього,
    тож непомітно змінити чи видалити запис неможливо — перевірка покаже розрив."""
    ts = models.DateTimeField()
    actor = models.ForeignKey(Profile, null=True, on_delete=models.SET_NULL)
    actor_code = models.CharField(max_length=20, blank=True, default="")
    action = models.CharField(max_length=200)
    obj_type = models.CharField(max_length=30)
    obj_id = models.CharField(max_length=30)
    field = models.CharField(max_length=60, blank=True)
    old_value = models.TextField(blank=True)
    new_value = models.TextField(blank=True)
    prev_hash = models.CharField(max_length=64)
    hash = models.CharField(max_length=64)

    class Meta:
        ordering = ["id"]

    @property
    def resolved_actor_code(self) -> str:
        if self.actor_code:
            return self.actor_code
        return self.actor.code if self.actor_id and self.actor else ""

    def payload(self):
        return json.dumps({
            "ts": self.ts.astimezone(dt_timezone.utc).isoformat(), "actor": self.resolved_actor_code,
            "action": self.action, "obj_type": self.obj_type, "obj_id": self.obj_id,
            "field": self.field, "old": self.old_value, "new": self.new_value, "prev": self.prev_hash,
        }, ensure_ascii=False, sort_keys=True)

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Запис журналу незмінний.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Запис журналу не можна видалити.")

    @classmethod
    def write(cls, actor, action, obj_type, obj_id, field="", old="", new="", ts=None, actor_code=""):
        code_val = actor.code if actor else (actor_code or "")
        with transaction.atomic():
            last = cls.objects.select_for_update().order_by("-id").first()
            rec = cls(ts=ts or timezone.now(), actor=actor, actor_code=code_val, action=action, obj_type=obj_type,
                      obj_id=str(obj_id), field=field, old_value="" if old is None else str(old),
                      new_value="" if new is None else str(new), prev_hash=last.hash if last else "0" * 64)
            rec.hash = hashlib.sha256(rec.payload().encode("utf-8")).hexdigest()
            rec.save()
            return rec

    @classmethod
    def verify_chain(cls):
        prev = "0" * 64
        n = 0
        for rec in cls.objects.select_related("actor").order_by("id").iterator():
            if rec.prev_hash != prev or hashlib.sha256(rec.payload().encode("utf-8")).hexdigest() != rec.hash:
                return {"ok": False, "checked": n, "broken_at": rec.id}
            prev = rec.hash
            n += 1
        return {"ok": True, "checked": n, "broken_at": None}


class ReportSnapshot(models.Model):
    """Незмінний зліпок офіційного звіту для перевірки цілісності (HMAC-SHA256).

    Фіксує стан звіту на момент вивантаження/перегляду, хеш даних SHA-256
    та цифровий підпис HMAC-SHA256 на основі SECRET_KEY сервера.
    Забороняє редагування та видалення після збереження.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    period = models.ForeignKey(ReportingPeriod, on_delete=models.PROTECT, related_name="report_snapshots")
    year = models.IntegerField(default=2026)
    half = models.IntegerField(default=1)
    report_type = models.CharField(max_length=50, default="portal")
    created_at = models.DateTimeField(default=timezone.now)
    created_by = models.ForeignKey(Profile, null=True, blank=True, on_delete=models.SET_NULL, related_name="report_snapshots")
    created_by_code = models.CharField(max_length=30, blank=True, default="")
    organ_name = models.CharField(max_length=255, blank=True, default="")
    report_hash = models.CharField(max_length=64, help_text="SHA-256 канонічного JSON з рядками звіту")
    signature = models.CharField(max_length=64, help_text="HMAC-SHA256 підпис сервера")
    total_measures = models.IntegerField(default=0)
    rows_count = models.IntegerField(default=0)
    summary = models.JSONField(blank=True, default=dict)
    raw_data = models.JSONField(blank=True, default=list)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Зліпок звіту"
        verbose_name_plural = "Зліпки звітів"

    def compute_signature(self, secret_key: str | None = None) -> str:
        key = (secret_key or settings.SECRET_KEY).encode("utf-8")
        payload = f"{self.id}:{self.period_id}:{self.year}:{self.half}:{self.report_hash}".encode("utf-8")
        return hmac.new(key, payload, hashlib.sha256).hexdigest()

    def verify_signature(self, sig: str) -> bool:
        expected = self.compute_signature()
        return hmac.compare_digest(self.signature, sig) and hmac.compare_digest(expected, sig)

    def save(self, *args, **kwargs):
        if self.pk and ReportSnapshot.objects.filter(pk=self.pk).exists():
            raise ValidationError("Зліпок звіту незмінний: його не можна змінювати після створення.")
        if not self.signature:
            self.signature = self.compute_signature()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Зліпок звіту не можна видалити.")
