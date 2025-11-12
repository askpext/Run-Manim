from django.core.management.base import BaseCommand
from django_q.models import Schedule

class Command(BaseCommand):
    help = "Creates or updates the Cluster heartbeat schedule for django-q."

    def handle(self, *args, **options):
        schedule, created = Schedule.objects.get_or_create(
            name='Cluster heartbeat',
            defaults={
                'func': 'manim.tasks.ping_cluster',
                'schedule_type': 'I',
                'minutes': 1,
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS("Created Cluster heartbeat schedule."))
        else:
            self.stdout.write(self.style.WARNING("Cluster heartbeat already exists."))
