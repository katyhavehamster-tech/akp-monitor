import json
import os
from pathlib import Path

from django.conf import settings
from django.core.management import BaseCommand
from django.utils import timezone

from monitor.key_crypto import generate_key_file
from monitor.models import Profile, UserAccessKey


class Command(BaseCommand):
    help = "Локальний випуск ключів доступу (.key) для користувачів та збереження у закриту теку"

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            type=str,
            default="demo",
            help="Пароль захисту ключів (за замовчуванням 'demo')",
        )
        parser.add_argument(
            "--output",
            type=str,
            default="./local_keys",
            help="Шлях до теки для збереження файлів .key (за замовчуванням ./local_keys)",
        )
        parser.add_argument(
            "--user",
            type=str,
            default=None,
            help="Логін або код конкретного користувача (наприклад, u-001)",
        )

    def handle(self, *args, **options):
        password = options["password"]
        out_dir = Path(options["output"])
        if not out_dir.is_absolute():
            out_dir = Path(settings.BASE_DIR).parent / out_dir

        out_dir.mkdir(parents=True, exist_ok=True)
        user_filter = options.get("user")

        qs = Profile.objects.select_related("user").order_by("code")
        if user_filter:
            qs = qs.filter(user__username__iexact=user_filter) | qs.filter(code__iexact=user_filter)

        count = 0
        for p in qs:
            login = p.user.username
            key_data = generate_key_file(
                user_login=login,
                role=p.role,
                password=password,
            )

            # Відкликаємо попередні активні ключі
            UserAccessKey.objects.filter(user=p.user, is_revoked=False).update(
                is_revoked=True,
                revoked_at=timezone.now(),
            )

            # Реєструємо публічний ключ
            UserAccessKey.objects.create(
                user=p.user,
                public_key_pem=key_data["crypto"]["public_key"],
                fingerprint=key_data["fingerprint"],
            )

            # Записуємо локальний файл ключа
            key_filename = f"akp_{login.lower()}.key"
            file_path = out_dir / key_filename
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(key_data, f, indent=2, ensure_ascii=False)

            self.stdout.write(
                self.style.SUCCESS(
                    f"✓ Випущено ключ для {login} ({p.role}): {key_filename} [SHA-256: {key_data['fingerprint'][:16]}...]"
                )
            )
            count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"\nУспішно згенеровано {count} ключів у теку: {out_dir}\n"
                f"Пароль захисту: «{password}»\n"
                "ПРИВАТНІ КЛЮЧІ ЗБЕРЕЖЕНО ВИКЛЮЧНО ЛОКАЛЬНО ТА ЗАХИЩЕНО В .gitignore"
            )
        )
