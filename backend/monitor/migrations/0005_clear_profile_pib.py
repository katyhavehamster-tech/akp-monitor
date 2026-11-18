from django.db import migrations


def clear_profile_pib(apps, schema_editor):
    Profile = apps.get_model("monitor", "Profile")
    SystemSettings = apps.get_model("monitor", "SystemSettings")
    Profile.objects.all().update(full_name="")
    SystemSettings.objects.all().update(
        signatory_name="Олександр КОВАЛЕНКО",
        head_signatory_name="Валерій СОКОЛОВ",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("monitor", "0004_security_audit_integrity"),
    ]

    operations = [
        migrations.RunPython(clear_profile_pib, migrations.RunPython.noop),
    ]
