---
category: Oversikt
---

# Login

Innloggingskort sentrert på siden (`.center` > `form.card.login`). Kaller `/api/auth/login`, og deretter `onLogin(login)`.

```jsx
<Login onLogin={(login) => setUser(login)} />
```
