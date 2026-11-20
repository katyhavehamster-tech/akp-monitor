"""Рольова модель доступу.

| Роль  | Хто                                  | Що може |
|-------|--------------------------------------|---------|
| KOORD | уповноважений (адміністратор програми) | усе щодо змісту: план, погодження, звіти, рекомендації, опитування |
| ADMIN | технічний адміністратор              | користувачі, звітні вікна, налаштування, перевірка цілісності; зміст не змінює |
| KER   | керівник                             | лише перегляд усієї інформації |
| VYK   | виконавець (відповідальна особа підрозділу) | лише заходи свого підрозділу; внесення — тільки у відкрите вікно |
| AUDIT | внутрішній аудитор                   | аналітика, внутрішній аудит, опитування (із цифровим маркуванням ІзОД/ДСК) |
"""
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import BasePermission

from .models import Measure, Role

ALL = {Role.KOORD, Role.ADMIN, Role.KER, Role.VYK, Role.AUDIT, "ANAL"}
VIEW_ALL = {Role.KOORD, Role.ADMIN, Role.KER, Role.AUDIT, "ANAL"}
CONTENT_EDIT = {Role.KOORD, Role.ADMIN}
MEASURE_MANAGE = {Role.KOORD, Role.ADMIN}
TECH = {Role.ADMIN}
SURVEYS = {Role.KOORD, Role.ADMIN, Role.AUDIT, "ANAL"}
SURVEYS_VIEW = {Role.KOORD, Role.ADMIN, Role.AUDIT, "ANAL"}
SURVEYS_EDIT = {Role.KOORD, Role.ADMIN}
AUDIT = {Role.KOORD, Role.ADMIN, Role.KER, Role.AUDIT, "ANAL"}


def profile(request):
    p = getattr(request.user, "profile", None)
    if p is None:
        raise PermissionDenied("Обліковий запис не має профілю в системі.")
    if hasattr(request.user, "access_keys"):
        active_keys = request.user.access_keys.filter(is_revoked=False)
        if not active_keys.exists():
            raise AuthenticationFailed("Особистий ключ доступу відкликано або заблоковано.")
        latest_act = active_keys.order_by("-created_at").first()
        if latest_act and latest_act.expires_at and latest_act.expires_at < timezone.now():
            raise AuthenticationFailed("Термін дії особистого ключа закінчився. Зверніться до адміністратора для його перевипуску.")
    return p


def require(request, roles, msg="Недостатньо прав для цієї дії."):
    p = profile(request)
    if p.role not in roles:
        raise PermissionDenied(msg)
    return p


def scoped_measures(p):
    qs = Measure.objects.all()
    if p.role == Role.VYK:
        return qs.filter(responsible_unit=p.unit)
    return qs


def can_see_measure(p, m: Measure):
    return p.role in VIEW_ALL or (p.role == Role.VYK and m.responsible_unit_id == p.unit_id)


class HasProfile(BasePermission):
    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated and hasattr(request.user, "profile")):
            return False
        if hasattr(request.user, "access_keys"):
            active_keys = request.user.access_keys.filter(is_revoked=False)
            if not active_keys.exists():
                return False
            latest_act = active_keys.order_by("-created_at").first()
            if latest_act and latest_act.expires_at and latest_act.expires_at < timezone.now():
                return False
        return True
