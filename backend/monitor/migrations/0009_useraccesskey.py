import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("monitor", "0008_measure_exclusion_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserAccessKey",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("public_key_pem", models.TextField(verbose_name="Публічний ключ (PEM)")),
                ("fingerprint", models.CharField(db_index=True, max_length=64, verbose_name="SHA-256 відбиток")),
                ("is_revoked", models.BooleanField(default=False, verbose_name="Відкликано")),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now, verbose_name="Дата випуску")),
                ("revoked_at", models.DateTimeField(blank=True, null=True, verbose_name="Дата відкликання")),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="access_keys",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Ключ доступу",
                "verbose_name_plural": "Ключі доступу",
                "ordering": ["-created_at"],
            },
        ),
    ]
