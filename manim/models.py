from django.contrib.auth.models import User
from django.db import models

class Code(models.Model):
    name = models.CharField(max_length=60)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='codes')
    code_text = models.TextField()

    def __str__(self):
        return f"Code for {self.user.username}"
 


class ClusterHeartbeat(models.Model):
    last_ping = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Cluster last ping: {self.last_ping}"
