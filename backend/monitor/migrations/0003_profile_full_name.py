from django.db import migrations, models

DEFAULT_NAMES = {
    "U-001": "Антон ПРЯДКО",
    "U-002": "Олександр КОВАЛЕНКО",
    "U-003": "Ірина МЕЛЬНИК",
    "U-004": "Валерій СОКОЛОВ",
    "U-005": "Дмитро БОНДАРЕНКО",
    "U-006": "Марія ШЕВЧЕНКО",
    "U-007": "Сергій ТКАЧЕНКО",
    "U-008": "Андрій КРАВЧЕНКО",
    "U-009": "Олена ОЛІЙНИК",
    "U-010": "Віктор ПОЛІЩУК",
    "U-011": "Наталія МОРОЗ",
    "U-012": "Оксана ЛИСЕНКО",
    "U-013": "Максим САВЧЕНКО",
    "U-014": "Ігор РУДЕНКО",
    "U-015": "Володимир ПЕТРЕНКО",
    "U-016": "Тетяна КЛИМЕНКО",
    "U-017": "Богдан ПАВЛЕНКО",
    "U-018": "Юрій КУЗЬМЕНКО",
    "U-019": "Микола ПОНОМАРЕНКО",
}


def populate_names(apps, schema_editor):
    Profile = apps.get_model("monitor", "Profile")
    SystemSettings = apps.get_model("monitor", "SystemSettings")
    for p in Profile.objects.all():
        if not getattr(p, "full_name", ""):
            p.full_name = DEFAULT_NAMES.get(p.code, f"Користувач {p.code}")
            p.save(update_fields=["full_name"])
    for s in SystemSettings.objects.all():
        if not s.signatory_name or s.signatory_name == "Власне імʼя ПРІЗВИЩЕ":
            s.signatory_name = DEFAULT_NAMES["U-002"]
        if not s.head_signatory_name or s.head_signatory_name == "Власне імʼя ПРІЗВИЩЕ":
            s.head_signatory_name = DEFAULT_NAMES["U-004"]
        s.save()


class Migration(migrations.Migration):

    dependencies = [
        ("monitor", "0002_systemsettings_signatories"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="full_name",
            field=models.CharField(
                blank=True,
                default="",
                max_length=200,
                verbose_name="Власне імʼя ПРІЗВИЩЕ (ПІБ)",
            ),
        ),
        migrations.RunPython(populate_names, migrations.RunPython.noop),
    ]
