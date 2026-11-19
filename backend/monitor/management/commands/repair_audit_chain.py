"""Management-команда для відновлення ланцюжка хешів AuditLog.

Використання:
    python manage.py repair_audit_chain          # лише перевірка (dry-run)
    python manage.py repair_audit_chain --fix    # виправити розрив і перерахувати хеші
"""
import hashlib

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from monitor.models import AuditLog


class Command(BaseCommand):
    help = "Перевіряє та за потреби відновлює ланцюжок хешів AuditLog (SHA-256)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fix",
            action="store_true",
            help="Фактично виправити ланцюжок (без цього прапорця — лише діагностика).",
        )

    def handle(self, *args, **options):
        fix = options["fix"]
        self.stdout.write("Перевірка ланцюжка хешів AuditLog…\n")

        result = AuditLog.verify_chain()
        total = result["checked"]

        if result["ok"]:
            self.stdout.write(self.style.SUCCESS(f"Ланцюжок цілісний: {total} записів перевірено, розривів немає."))
            return

        broken_at = result["broken_at"]
        self.stdout.write(self.style.WARNING(
            f"Розрив знайдено на записі #{broken_at} (перевірено {total} записів до розриву)."
        ))

        if not fix:
            self.stdout.write(
                "Для виправлення запустіть із прапорцем --fix:\n"
                "  python manage.py repair_audit_chain --fix"
            )
            return

        self.stdout.write("Відновлення ланцюжка хешів…")

        with transaction.atomic():
            # Блокуємо таблицю від паралельного запису
            all_entries = list(
                AuditLog.objects.select_for_update().order_by("id").select_related("actor")
            )

            prev_hash = "0" * 64
            repaired = 0

            for rec in all_entries:
                expected_prev = prev_hash
                expected_hash = hashlib.sha256(
                    rec.payload().encode("utf-8")
                ).hexdigest()

                need_fix = False

                if rec.prev_hash != expected_prev:
                    self.stdout.write(
                        f"  #{rec.id}: prev_hash розбіжність "
                        f"(було {rec.prev_hash[:12]}…, має бути {expected_prev[:12]}…)"
                    )
                    # Оновлюємо prev_hash → перерахувати payload → новий hash
                    rec.prev_hash = expected_prev
                    need_fix = True

                if need_fix:
                    # Перерахувати hash із виправленим prev_hash
                    rec.hash = hashlib.sha256(rec.payload().encode("utf-8")).hexdigest()
                    # Обходимо захист save() від оновлень: оновлюємо лише потрібні поля напряму
                    AuditLog.objects.filter(pk=rec.pk).update(
                        prev_hash=rec.prev_hash,
                        hash=rec.hash,
                    )
                    repaired += 1
                elif rec.hash != expected_hash:
                    # hash теж розійшовся (можливо, payload змінився)
                    self.stdout.write(
                        f"  #{rec.id}: hash розбіжність "
                        f"(було {rec.hash[:12]}…, перераховано {expected_hash[:12]}…)"
                    )
                    rec.hash = expected_hash
                    AuditLog.objects.filter(pk=rec.pk).update(hash=rec.hash)
                    repaired += 1

                prev_hash = rec.hash

        # Фінальна верифікація
        final = AuditLog.verify_chain()
        if final["ok"]:
            self.stdout.write(self.style.SUCCESS(
                f"Ланцюжок відновлено: виправлено {repaired} записів із {len(all_entries)}. "
                f"Верифікація: OK ({final['checked']} записів)."
            ))
        else:
            raise CommandError(
                f"Не вдалося повністю відновити ланцюжок! "
                f"Розрив залишається на записі #{final['broken_at']}."
            )
