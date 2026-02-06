# Blind Date – جریان سوکت (Backend + Frontend)

## خلاصه

دو کاربر با کلیک روی «Enter Blind Date» به صف می‌پیوندند. بک‌اند آن‌ها را با **کشور** و **جنسیت/lookingFor** (فقط Male, Female, Other) چک می‌کند. در صورت تطابق، یک سشن ساخته می‌شود و به هر دو با رویداد `match_found` فرستاده می‌شود.

---

## Backend (sockets/socketHandler.js)

### ۱. اتصال (connection)

- اگر در handshake مقدار `userId` بیاید: `socket.userId = userId` و `socket.join(userId)`.
- فرانتِ Blind Date معمولاً `userId` در handshake نمی‌فرستد، پس این مرحله برای این صفحه خالی است.

### ۲. join_room

- فرانت بعد از `connect` می‌فرستد: `socket.emit("join_room", currentUser._id)`.
- بک‌اند: `roomId = string(id)` و `socket.join(roomId)` و `socket.userId = roomId`.
- نتیجه: سوکت در اتاقی با نام برابر **رشتهٔ userId** قرار می‌گیرد تا بعداً `io.to(roomId).emit(...)` به او برسد.

### ۳. join_blind_queue

- فرانت می‌فرستد: `{ userId: currentUser._id, criteria: { gender, lookingFor, location } }`.
- بک‌اند:
  - `normalizedUserId = String(currentUserId)` و **همین‌جا** `socket.join(normalizedUserId)` تا مطمئن شویم این سوکت در room خودش است.
  - اگر در صف کاربری با معیارهای سازگار باشد → `findMatch` او را برمی‌گرداند.
  - در صورت مچ: هر دو از صف حذف می‌شوند، سشن با `BlindSession` ساخته و با `.lean()` به صورت آبجکت ساده برمی‌گردد، سپس:
    - `io.to(normalizedUserId).emit("match_found", populatedSession)`
    - `io.to(matchUserId).emit("match_found", populatedSession)`
- **ارسال match_found:** به هر دو کاربر با **socket.id** ارسال می‌شود (`io.to(currentSocketId).emit` و `io.to(match.socketId).emit`) تا مستقل از room حتماً برسد.
- سشن قبل از ارسال با `JSON.parse(JSON.stringify(...))` آبجکت ساده می‌شود و `participants` با `.populate("participants", "name avatar")` برای نمایش نام/آواتار پارتنر پر می‌شود.

### ۴. منطق مچ (findMatch)

- دو کاربر متفاوت (مقایسهٔ `userId` به صورت string).
- کشور: یکی بودن یا خالی/نامشخص بودن هر دو.
- جنسیت: هر دو طرف فقط Male/Female/Other دارند؛ `user1.lookingFor === user2.gender` و `user2.lookingFor === user1.gender`.

---

## Frontend (BlindDatePage.jsx)

### ۱. سوکت

- در `useEffect` با وابستگی به `currentUser?._id` و `API_URL`: یک سوکت با `io(API_URL, { withCredentials: true })` ساخته می‌شود.

### ۲. بعد از connect

- `onConnect`: `setSocketReady(true)` و `socket.emit("join_room", uid)` با `uid` به صورت string.

### ۳. کلیک «Enter Blind Date»

- `socket.emit("join_blind_queue", { userId: currentUser._id, criteria: { age, gender, lookingFor, location } })`.

### ۴. لیستنرها

- `match_found` → `setSession(newSession)` و `setIsSearching(false)` و در حالت DEV یک لاگ در کنسول.
- `session_update` → به‌روزرسانی سشن.
- `session_cancelled` → وضعیت لغو.
- `error` و `queue_status` → در DEV در کنسول لاگ می‌شوند.

---

## نکات مهم

- **Room همیشه با string userId** ساخته و استفاده می‌شود (هم در `join_room` هم در `join_blind_queue` و هم در `io.to(...)`).
- سشن قبل از emit با `.lean()` به آبجکت ساده تبدیل می‌شود تا سریالایز سوکت مشکلی نداشته باشد.
- در حالت توسعه (`import.meta.env.DEV`) در کنسول فرانت می‌توان دید آیا `match_found` یا `queue_status` یا `error` رسیده است.
