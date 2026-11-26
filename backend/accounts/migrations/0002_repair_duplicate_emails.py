from django.db import migrations


def blank_duplicate_emails(apps, schema_editor):
    """
    Before emails become unique, keep the OLDEST account's email when several accounts share one
    (ignoring letter case) and clear it on the later ones, so the constraint can be applied.
    Those users can still sign in with their username. Cleared addresses are printed.
    """
    User = apps.get_model('accounts', 'User')
    seen = {}
    for user in User.objects.exclude(email='').order_by('id'):
        key = user.email.strip().lower()
        if key in seen:
            print(f'\n  accounts: cleared duplicate email {user.email!r} from user {user.username!r} '
                  f'(kept on {seen[key]!r})')
            user.email = ''
            user.save(update_fields=['email'])
        else:
            seen[key] = user.username


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(blank_duplicate_emails, migrations.RunPython.noop),
    ]
