"""Unlock accounts that tripped the failed-login limits (see accounts/login_guard.py)."""

from django.core.cache import caches
from django.core.cache.backends.db import DatabaseCache
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections, router

from accounts import login_guard


def _like_escape(text: str) -> str:
    return text.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


class Command(BaseCommand):
    help = (
        'Clear failed-login lockout counters so a locked-out person can sign in again right away. '
        'Use --username for one account, or --all to clear every counter (accounts and addresses).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--username',
            help='Unlock this account (its username or email). Address-wide counters are left alone.',
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Clear every lockout counter for all accounts and addresses.',
        )

    def handle(self, *args, **options):
        username = (options['username'] or '').strip()
        if bool(username) == bool(options['all']):
            raise CommandError('Use exactly one of --username <name> or --all.')

        cache = caches['default']
        if not isinstance(cache, DatabaseCache):
            raise CommandError('Lockout counters are expected in the database cache; it is not in use.')

        model = cache.cache_model_class
        connection = connections[router.db_for_write(model)]
        table = connection.ops.quote_name(model._meta.db_table)

        try:
            with connection.cursor() as cursor:
                if username:
                    name = login_guard.account_key(username)
                    cursor.execute(
                        f'DELETE FROM {table} WHERE cache_key = %s',
                        [cache.make_key(f'login:acct:{name}')],
                    )
                    deleted = cursor.rowcount
                    pair_pattern = _like_escape(cache.make_key('login:pair:')) + '%:' + _like_escape(name)
                    cursor.execute(
                        f"DELETE FROM {table} WHERE cache_key LIKE %s ESCAPE '\\'",
                        [pair_pattern],
                    )
                    deleted += cursor.rowcount
                else:
                    cursor.execute(
                        f"DELETE FROM {table} WHERE cache_key LIKE %s ESCAPE '\\'",
                        [_like_escape(cache.make_key('login:')) + '%'],
                    )
                    deleted = cursor.rowcount
        except DatabaseError as exc:
            raise CommandError(
                f'Could not clear lockouts: {exc}. '
                'If the cache table is missing, run: python manage.py createcachetable'
            )

        target = f'account "{username}"' if username else 'all accounts'
        self.stdout.write(self.style.SUCCESS(f'Cleared {deleted} lockout counter(s) for {target}.'))
