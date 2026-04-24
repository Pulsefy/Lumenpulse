# 🔔 Notifications Feature - Quick Setup & Test Guide

## 🚀 Quick Start

### Step 1: Run Database Migration
```bash
cd apps/backend
npm run typeorm migration:run
```

### Step 2: Seed Test Data (Optional)
```bash
npx ts-node scripts/seed-test-notifications.ts
```

### Step 3: Start Backend
```bash
npm run start:dev
```

### Step 4: Start Mobile App
```bash
cd apps/mobile
npm start
```

---

## 🧪 Testing Checklist

### Backend API Testing (using Postman/cURL)

1. **Login first to get JWT token:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

2. **Get all notifications:**
```bash
curl -X GET http://localhost:3000/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

3. **Get unread count:**
```bash
curl -X GET http://localhost:3000/notifications/unread-count \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

4. **Mark notification as read:**
```bash
curl -X POST http://localhost:3000/notifications/1/read \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

5. **Mark all as read:**
```bash
curl -X POST http://localhost:3000/notifications/mark-all-read \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### Mobile App Testing

#### Test Scenario 1: View Notifications
1. ✅ Open mobile app and login
2. ✅ Look at home screen - bell icon should show red badge with count
3. ✅ Tap bell icon
4. ✅ Verify notifications screen opens
5. ✅ Verify notifications are listed with proper styling

#### Test Scenario 2: Mark as Read (Individual)
1. ✅ Find an unread notification (has red dot)
2. ✅ Tap the notification
3. ✅ Verify it changes to read state (background color changes)
4. ✅ Verify red dot disappears
5. ✅ Verify badge count decreases by 1

#### Test Scenario 3: Mark All as Read
1. ✅ Ensure you have multiple unread notifications
2. ✅ Tap "Mark all" button in header
3. ✅ Verify all notifications change to read state
4. ✅ Verify badge count goes to 0
5. ✅ Verify "Mark all" button disappears

#### Test Scenario 4: Empty State
1. ✅ Mark all notifications as read
2. ✅ Or delete all notifications from database
3. ✅ Open notifications screen
4. ✅ Verify empty state shows:
   - Bell icon (🔔)
   - "No notifications yet" text
   - Description text below

#### Test Scenario 5: Navigation
1. ✅ From notifications screen, tap back button
2. ✅ Verify you return to home screen
3. ✅ Tap bell icon again
4. ✅ Verify notifications screen opens

---

## 🐛 Troubleshooting

### Issue: "No notifications found"
**Solution:** Run the seeder script to create test data

### Issue: "JWT token expired"
**Solution:** Login again to get a fresh token

### Issue: "Migration not running"
**Solution:** Check database connection in `.env` file

### Issue: "Bell icon not showing badge"
**Solution:** 
1. Verify you have unread notifications
2. Check NotificationsContext is properly wrapped in app layout
3. Verify API is returning data correctly

---

## 📊 Expected Results

### Backend Response Example
```json
[
  {
    "id": 1,
    "title": "Price Alert: XLM Surge",
    "message": "Stellar (XLM) has increased by 15% in the last 24 hours. Current price: $0.12",
    "type": "price_alert",
    "read": false,
    "createdAt": "2026-04-24T10:30:00.000Z"
  },
  {
    "id": 2,
    "title": "New Partnership Announced",
    "message": "Stellar Development Foundation announces partnership with major financial institution.",
    "type": "news_alert",
    "read": true,
    "createdAt": "2026-04-24T09:15:00.000Z"
  }
]
```

### Mobile UI States

**Unread Notification:**
- Background: Accent secondary color (highlighted)
- Red dot indicator in top-right
- Status text: "● Unread"

**Read Notification:**
- Background: Card color (normal)
- No red dot
- Status text: "✓ Read"

**Empty State:**
- Centered bell icon (large)
- "No notifications yet" heading
- "Price alerts and account activity will show up here." subtext

---

## 📸 Screenshot Checklist

Capture these screenshots for your commit:

1. [ ] Home screen with bell icon showing badge count (e.g., "3")
2. [ ] Notifications list with mix of read/unread items
3. [ ] Close-up of unread notification with red dot
4. [ ] Close-up of read notification
5. [ ] Empty state screen
6. [ ] "Mark all" button visible when unread > 0

---

## ✅ Done Criteria Verification

- [x] NotificationsScreen fetching from GET /notifications
- [x] Mark as read functionality (tap or button)
- [x] Empty state message when no notifications exist
- [x] Persistent badge count on the bell icon
- [x] Professional implementation with error handling
- [x] TypeScript types throughout
- [x] JWT authentication on all endpoints
- [x] Database migration created
- [x] Test seeder script available

---

## 🎉 Success!

If all tests pass, you're ready to commit:

```bash
git checkout -b feat/mobile-notifications-ui
git add .
git commit -m "feat(mobile): implement in-app notification center

- Add backend notifications module with CRUD endpoints
- Create notifications screen with read/unread states
- Implement bell icon with persistent badge count
- Add database migration and test seeder
- Wire up API integration with optimistic updates
- Include empty state for no notifications

Closes #150"
```

---

**Need Help?** Check `NOTIFICATIONS_IMPLEMENTATION.md` for full documentation.
