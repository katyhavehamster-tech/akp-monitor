import django.db.models.deletion
from django.db import migrations, models

ROLE_LABELS = {
    "KOORD": "Уповноважений (адміністратор програми)",
    "ADMIN": "Технічний адміністратор",
    "KER": "Керівник",
    "VYK": "Виконавець",
    "ANAL": "Аналітик",
}


def backfill_codes(apps, schema_editor):
    AuditLog = apps.get_model("monitor", "AuditLog")
    Comment = apps.get_model("monitor", "Comment")

    for rec in AuditLog.objects.select_related("actor").filter(actor__isnull=False, actor_code=""):
        AuditLog.objects.filter(pk=rec.pk).update(actor_code=rec.actor.code)

    for c in Comment.objects.select_related("author").filter(author__isnull=False):
        if not c.author_code or not c.author_role_name:
            Comment.objects.filter(pk=c.pk).update(
                author_code=c.author.code,
                author_role_name=ROLE_LABELS.get(c.author.role, c.author.role),
            )


class Migration(migrations.Migration):

    dependencies = [
        ("monitor", "0003_profile_full_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="auditlog",
            name="actor_code",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.AlterField(
            model_name="comment",
            name="author",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                to="monitor.profile",
            ),
        ),
        migrations.AddField(
            model_name="comment",
            name="author_code",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.AddField(
            model_name="comment",
            name="author_role_name",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.RunPython(backfill_codes, migrations.RunPython.noop),
    ]
