from .models import ClusterHeartbeat

# update the database ClusterHeartbeat. This will be called every minute from apps.py
def ping_cluster():
    ClusterHeartbeat.objects.update_or_create(pk=1)
