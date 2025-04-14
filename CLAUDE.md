# Bri Bot Development Notes

## Recent Features

### Thread Support
- Implemented conversation threading support
- Allows separate conversation contexts in Discord threads
- Each thread maintains its own conversation history

### Database Migration
Before deploying the thread support feature, run the migration script:

```bash
# Connect to your PostgreSQL database and run the migration
psql -U your_username -d your_database -f migrations/add_thread_support.sql
```

## Testing Guidelines
- Always run tests before committing changes
- Test new features in isolation before integration