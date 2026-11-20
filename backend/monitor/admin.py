from django.contrib import admin

from . import models as m

for model in [m.Organ, m.Unit, m.Profile, m.Program, m.Section, m.Risk, m.RiskMeasurement, m.Measure,
              m.DeadlineChange, m.ReportingPeriod, m.Execution, m.Comment, m.Recommendation, m.SystemSettings]:
    admin.site.register(model)


@admin.register(m.Evidence)
class EvidenceAdmin(admin.ModelAdmin):
    list_display = ["code", "measure", "title", "doc_date", "sha256"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(m.AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["id", "ts", "actor", "action", "obj_type", "obj_id", "field"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(m.UserAccessKey)
class UserAccessKeyAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "fingerprint", "is_revoked", "created_at", "revoked_at"]
    list_filter = ["is_revoked"]
    search_fields = ["user__username", "fingerprint"]


@admin.register(m.UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "ip_address", "last_activity", "created_at"]
    search_fields = ["user__username", "ip_address", "token_key"]

