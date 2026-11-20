from django.db import migrations, models
import monitor.models


class Migration(migrations.Migration):

    dependencies = [
        ("monitor", "0011_usersession"),
    ]

    operations = [
        migrations.AddField(
            model_name="useraccesskey",
            name="expires_at",
            field=models.DateTimeField(
                blank=True,
                default=monitor.models.default_key_expiration,
                null=True,
                verbose_name="Дійсний до",
            ),
        ),
    ]
