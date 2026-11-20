"""Імпорт синтетичного набору організаторів (data/dataset/dani/*.csv).

    python manage.py import_dataset          # створює БД з нуля
    python manage.py import_dataset --flush  # очищує і імпортує повторно

Дані І півріччя 2026 р. потрапляють у звітний період 2026-Q2: квартальний звіт
виконавця кумулятивний, тож стан на кінець ІІ кварталу = стан на кінець півріччя.
"""
import csv
from datetime import date, datetime
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management import BaseCommand, call_command
from django.db import transaction
from django.utils import timezone
from rest_framework.authtoken.models import Token

from monitor.key_crypto import get_or_create_test_key_container
from monitor.models import (AuditLog, DeadlineChange, Evidence, Execution, Measure, Organ, Profile, Program,
                            ReportingPeriod, Risk, RiskMeasurement, Section, SystemSettings, Unit, UserAccessKey)

DATA = Path(settings.BASE_DIR) / "data" / "dataset" / "dani"
DEMO_PASSWORD = "demo"
DEMO_SIGNATORY = "Олександр КОВАЛЕНКО"
DEMO_HEAD_SIGNATORY = "Валерій СОКОЛОВ"



def rows(name):
    with open(DATA / f"{name}.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def d(s):
    return date.fromisoformat(s) if s else None


def dt(s):
    return timezone.make_aware(datetime.fromisoformat(s)) if s else None


def num(s):
    return float(s) if s not in ("", None) else None


class Command(BaseCommand):
    help = "Імпорт синтетичного набору даних Завдання 2"

    def add_arguments(self, parser):
        parser.add_argument("--flush", action="store_true")

    @transaction.atomic
    def handle(self, *args, flush=False, **kw):
        if flush:
            call_command("flush", interactive=False, verbosity=0)
        if Program.objects.exists():
            self.stdout.write("Дані вже імпортовано (використайте --flush).")
            return

        pr = rows("prohrama")[0]
        organ = Organ.objects.create(name=pr["organ"])
        units = {}
        for r in rows("pidrozdily"):
            units[r["id"]] = Unit.objects.create(code=r["id"], organ=organ, name=r["nazva"], type=r["typ"],
                                                 note=r["prymitka"])
        program = Program.objects.create(
            code=pr["id"], organ=organ, name=pr["nazva"], period_start=d(pr["period_pochatok"]),
            period_end=d(pr["period_kinets"]), approved=pr["zatverdzheno"], nazk_status=pr["stan_pohodzhennia_nazk"],
            restricted_info=pr["mistyt_informatsiiu_z_obmezhenym_dostupom"] == "так",
            coordinator_unit=units.get(pr["upovnovazhenyi_pidrozdil_id"]), goals=pr["tsili"], note=pr["prymitka"])
        sections = {r["kod"]: Section.objects.create(program=program, code=r["kod"], number=int(r["nomer"]),
                                                     portal_name=r["nazva_portal"]) for r in rows("rozdily")}

        profiles = {}
        for r in rows("korystuvachi"):
            u = User.objects.create_user(username=r["id"].lower(), password=DEMO_PASSWORD,
                                         is_staff=r["rol"] == "ADMIN", is_superuser=r["rol"] == "ADMIN")
            user_role = "AUDIT" if r["rol"] == "ANAL" else r["rol"]
            Token.objects.create(user=u)
            profiles[r["id"]] = Profile.objects.create(
                user=u, code=r["id"], full_name="", role=user_role,
                unit=units.get(r["pidrozdil_id"]), position=r["posada"],
            )
            # Реєструємо первинний електронний ключ доступу (TTL: 365 днів)
            kd = get_or_create_test_key_container(r["id"].lower(), user_role, DEMO_PASSWORD)
            UserAccessKey.objects.create(
                user=u,
                public_key_pem=kd["crypto"]["public_key"],
                fingerprint=kd["fingerprint"],
                expires_at=timezone.now() + timedelta(days=365),
            )

        risks = {}
        for r in rows("ryzyky"):
            risks[r["id"]] = Risk.objects.create(
                code=r["id"], program=program, process=r["funktsiia_protses"], name=r["nazva"], content=r["zmist"],
                sources=r["dzherela"], existing_controls=r["isnuiuchi_zakhody_kontroliu"],
                probability=int(r["imovirnist_x"]), consequences=int(r["naslidky_y"]),
                owner_unit=units.get(r["vlasnyk_pidrozdil_id"]), indicator=r["indykator_ryzyku"],
                indicator_unit=r["odynytsia"], direction=r["napriam"], baseline=float(r["indykator_bazove"]),
                target=float(r["indykator_tsil"]), target_date=d(r["data_tsili"]))
        for r in rows("vymiriuvannia_indykatoriv"):
            RiskMeasurement.objects.create(risk=risks[r["ryzyk_id"]], date=d(r["data"]),
                                           value=float(r["znachennia"]), source=r["dzherelo"])

        measures = {}
        for r in rows("zakhody"):
            m = Measure.objects.create(
                code=r["id"], program=program, section=sections[r["rozdil_kod"]], number=int(r["nomer_u_rozdili"]),
                content=r["zmist"], risk=risks.get(r["ryzyk_id"]), responsible_unit=units[r["vidpovidalnyi_pidrozdil_id"]],
                strok_text=r["strok_tekst"], strok_type=r["strok_typ"], strok_date=d(r["strok_data"]),
                indicator=r["indykator_vykonannia"], indicator_unit=r["indykator_odynytsia"],
                indicator_target=num(r["indykator_tsil"]), required_evidence=r["potribni_pidtverdzhennia"],
                resources=r["resursy"])
            for c in filter(None, (x.strip() for x in r["spivvykonavtsi"].split(";"))):
                m.co_units.add(units[c])
            measures[r["id"]] = m

        s = SystemSettings.get()
        s.today_override = date(2026, 7, 3)  # демо-дата: відкрите вікно внесення за ІІ квартал
        s.signatory_name = DEMO_SIGNATORY
        s.head_signatory_name = DEMO_HEAD_SIGNATORY
        s.save()
        periods = {}
        for y in range(program.period_start.year, program.period_end.year + 1):
            for q in range(1, 5):
                p = ReportingPeriod.make(y, q, s.window_days)
                p.save()
                periods[p.code] = p
        q2 = periods["2026-Q2"]

        for r in rows("perenesennia_strokiv"):
            DeadlineChange.objects.create(measure=measures[r["zakhid_id"]], decision_date=d(r["data_rishennia"]),
                                          old_date=d(r["staryi_strok"]), new_date=d(r["novyi_strok"]),
                                          reason=r["prychyna"], approved_by=profiles.get(r["pohodyv_korystuvach_id"]))

        log = sorted(rows("zhurnal_dii"), key=lambda r: r["id"])
        approvals = {r["obiekt_id"]: dt(r["chas"]) for r in log if r["diia"] == "погоджено координатором"}
        for r in rows("vykonannia_2026_h1"):
            entered = dt(r["data_vnesennia"])
            approved = r["pohodzheno_koordynatorom"] == "так"
            Execution.objects.create(
                measure=measures[r["zakhid_id"]], period=q2, status=r["status"], fact_date=d(r["fakt_data"]),
                result_text=r["opys_rezultatu"], indicator_fact=num(r["indykator_fakt"]),
                entered_by=profiles.get(r["vnis_korystuvach_id"]), entered_at=entered,
                approval="approved" if approved else ("submitted" if entered else "draft"),
                approved_by=profiles["U-002"] if approved else None,
                approved_at=approvals.get(r["zakhid_id"]) if approved else None)

        for r in rows("pidtverdzhennia"):
            Evidence.objects.create(
                code=r["id"], measure=measures[r["zakhid_id"]], period=q2, type=r["typ"], title=r["nazva"],
                doc_date=d(r["data_dokumenta"]), link=r["posylannia"], uploaded_at=dt(r["zavantazheno"]),
                uploaded_by=profiles.get(r["zavantazhyv_korystuvach_id"]), sha256=r["sha256"])

        for r in log:
            AuditLog.write(profiles.get(r["korystuvach_id"]), r["diia"], r["obiekt"], r["obiekt_id"], r["pole"],
                           r["stare_znachennia"], r["nove_znachennia"], ts=dt(r["chas"]))

        from monitor.models import Survey
        from monitor.surveys import parse_csv
        for f in sorted((Path(settings.BASE_DIR) / "data" / "surveys").glob("*.csv")):
            parsed = parse_csv(f.read_bytes())
            title = "Опитування, хвиля 1 (березень 2026)" if "khvylia_1" in f.name else \
                "Опитування, хвиля 2 (червень 2026)" if "khvylia_2" in f.name else f.stem
            Survey.objects.create(title=title, uploaded_by=profiles["U-002"], questions=parsed["questions"],
                                  answers=parsed["answers"], dropped_columns=parsed["dropped"])

        self.stdout.write(self.style.SUCCESS(
            f"Імпортовано: {Measure.objects.count()} заходів, {Risk.objects.count()} ризиків, "
            f"{Profile.objects.count()} користувачів, {Evidence.objects.count()} підтверджень, "
            f"{AuditLog.objects.count()} записів журналу. Пароль демо-користувачів: «{DEMO_PASSWORD}»."))
