import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },
    { duration: '20s', target: 50 }, // تست کوتاه‌تر برای دیباگ سریع
    { duration: '10s', target: 0 },
  ],
};

export default function () {
  const randomStr = Math.random().toString(36).substring(7);
  const email = `test_${randomStr}@k6.io`;
  const username = `user_${randomStr}`;

  const payload = JSON.stringify({
    name: "Stress Test User",
    username: username,
    email: email,
    password: "Password123!",
    gender: "Male",
    lookingFor: "Female"
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  const res = http.post('http://127.0.0.1:5000/api/user/signup', payload, params);

  // ✅ لاگ کردن ارور اگر وضعیت 201 نبود
  if (res.status !== 201) {
    console.log(`Error Status: ${res.status}, Body: ${res.body}`);
  }

  check(res, {
    'is status 201': (r) => r.status === 201,
  });

  sleep(1);
}
