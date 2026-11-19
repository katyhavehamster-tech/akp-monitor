import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("monitor", "0007_systemsettings_izod_audit_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="measure",
            name="is_excluded",
            field=models.BooleanField(
                default=False,
                verbose_name="Виключено з програми",
            ),
        ),
        migrations.AddField(
            model_name="measure",
            name="exclusion_reason",
            field=models.CharField(
                blank=True,
                max_length=500,
                verbose_name="Підстава виключення",
            ),
        ),
        migrations.AddField(
            model_name="measure",
            name="excluded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="measure",
            name="excluded_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="excluded_measures",
                to="monitor.profile",
            ),
        ),
    ]
