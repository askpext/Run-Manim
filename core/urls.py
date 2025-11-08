from django.urls import path
from core import views as home_view
from accounts import views as accounts_view


urlpatterns = [
    path('donate/', home_view.donate, name='donate'),
    path('signup/', accounts_view.signup_view, name='signup'),
    path('login/', accounts_view.login_view, name='login'),
    path('logout/', accounts_view.logout_view, name='logout'),
]