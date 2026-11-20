from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("monitor", "0010_formal_close_justification_and_rules_version"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token_key", models.CharField(db_index=True, max_length=40, verbose_name="Ключ токену")),
                ("key_fingerprint", models.CharField(blank=True, default="", max_length=64, verbose_name="SHA-256 відбиток ключа")),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True, verbose_name="IP-адреса")),
                ("user_agent", models.CharField(blank=True, default="", max_length=500, verbose_name="User-Agent (браузер/ОС)")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, verbose_name="Час входу")),
                ("last_activity", models.DateTimeField(db_index=True, default=django.utils.timezone.now, verbose_name="Час останньої активності")),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="user_sessions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Активна сесія",
                "verbose_name_plural": "Активні сесії",
                "ordering": ["-last_activity"],
            },
        ),
    ]
