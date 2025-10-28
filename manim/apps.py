from django.apps import AppConfig
from django.db.models.signals import post_migrate


# class RunConfig(AppConfig):
#     default_auto_field = 'django.db.models.BigAutoField'
#     name = 'manim'



class ManimConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'manim'

    def ready(self):
        import sys
        if 'migrate' in sys.argv or 'makemigrations' in sys.argv:
            return

        from django_q.models import Schedule #the model
        from django_q.tasks import schedule #the function

        # update the database every minute by executing ping_cluster() in tasks.py
        # since schedule is from django_q, this function only works if django_q is running.
        # so if this function works, probably qcluster is also running.
        # so we can use this to check if cluster is running.
        def create_heartbeat(sender, **kwargs):
            if not Schedule.objects.filter(name='Cluster heartbeat').exists():
                schedule(
                    'manim.tasks.ping_cluster',
                    name='Cluster heartbeat',
                    schedule_type='I',
                    minutes=1,
                )

        post_migrate.connect(create_heartbeat, sender=self)
