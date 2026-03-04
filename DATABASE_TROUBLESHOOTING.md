# Database Connection Troubleshooting Guide

## Error: P1001 - Can't reach database server

### Immediate Steps:

1. **Check Supabase Dashboard**
   - Go to your Supabase project
   - Verify database is active
   - Check connection string in Settings → Database

2. **Verify .env Configuration**
   Your .env should contain:
   ```
   DATABASE_URL="postgresql://[user]:[password]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
   DIRECT_URL="postgresql://[user]:[password]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
   ```

3. **Test Connection Manually**
   ```bash
   # Install PostgreSQL client if needed
   npm install -g pg
   
   # Test connection
   psql "postgresql://[user]:[password]@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres"
   ```

4. **Reset Database Connection**
   ```bash
   # Clear any existing connections
   npx prisma db push --force-reset
   
   # Regenerate Prisma client
   npx prisma generate
   
   # Restart dev server
   npm run dev
   ```

### If Still Failing:

**Option A: Use Different Supabase Region**
- Create new Supabase project in different region
- Update DATABASE_URL in .env

**Option B: Local Development Database**
```bash
# Install PostgreSQL locally
brew install postgresql  # Mac
# or
sudo apt-get install postgresql  # Linux

# Create local database
createdb reboundcart_dev

# Update .env temporarily
DATABASE_URL="postgresql://localhost:5432/reboundcart_dev"
```

**Option C: Check Supabase Plan**
- Verify your Supabase plan allows external connections
- Check if you've exceeded connection limits

### Common Issues:
- Wrong password in connection string
- Database paused/suspended
- Network firewall blocking port 5432
- Supabase region outage
- Invalid database name

### Need Help?
1. Check Supabase documentation: https://supabase.com/docs
2. Contact Supabase support
3. Try running without database first to isolate the issue
