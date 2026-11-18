from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("monitor", "0006_reportsnapshot"),
    ]

    operations = [
        migrations.AddField(
            model_name="systemsettings",
            name="izod_audit_mode",
            field=models.BooleanField(
                default=True,
                verbose_name="Режим ІзОД: посилений аудит переглядів та експорту",
            ),
        ),
    ]
