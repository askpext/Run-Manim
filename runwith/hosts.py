from django_hosts import patterns, host

host_patterns = patterns('',
    host(r'www', 'runwith.urls', name='www'),
    host(r'manim', 'manim.urls', name='manim'),
)
