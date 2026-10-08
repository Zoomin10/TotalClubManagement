# WWFC Digital Consent App

A full-stack web application for managing player registrations and digital consent forms for Wroughton & Wichelstowe Football Club (WWFC).

The system replaces paper-based registration forms with a secure digital workflow while providing administrators with visibility of player registrations, consent records, and registration statistics.

---

## 🚀 Features

### Player Registration (Frontend)
- Digital consent form
- Player details capture
- Emergency contact information (2 contacts)
- Medical information & allergies
- Consent flags (data, photos, videos)
- Signature capture (typed)

### Admin Dashboard
- Authenticated administrators can:

- Overview statistics:
  - Total registrations
  - Male / Female split (%)
  - Development vs Competitive players
  - Adult players
- Filter by:
  - Age group
  - Gender
- List of all registrations
- Click-to-view full registration (modal)
- Delete registrations
- Export to CSV

---

## 🏗️ Tech Stack

### Frontend
- React (Vite)
- CSS (custom styling)
- Fetch API

### Backend
- Node.js
- Express
- Prisma ORM

### Database
- PostgreSQL (Railway)

### Hosting
- Railway (frontend + backend + database)

---

## 📁 Project Structure
    Consent/
    ├── frontend/ # React app
    │ ├── src/
    │ ├── public/
    │
    ├── backend/ # Node/Express API
    │ ├── src/
    │ ├── prisma/
    │
    ├── scripts/ # helper scripts
    └── README.md

---
### Security
- Admin Authentication

- The admin area is protected by:

        Password-based login
        JWT authentication
        HTTP-only cookies
        Protected API routes

- Unauthenticated users cannot access:

        Dashboard data
        Registration records
        CSV exports
        Delete functionality
        Session Management

- Authentication uses:



## ⚙️ Environment Variables

### Backend (`backend/.env`)

## Environment Configuration
- Development

        Frontend URL:

              https://wwfc-consent-form-development.up.railway.app

        Backend URL:

            https://wwfc-consent-development-backend.up.railway.app

- Required Backend Variables:

        DATABASE_URL=
        ADMIN_PASSWORD=
        JWT_SECRET=
        FRONTEND_URL=
        NODE_ENV=production
        Production

- Required Backend Variables:

        DATABASE_URL=
        ADMIN_PASSWORD=
        JWT_SECRET=
        FRONTEND_URL=
        NODE_ENV=production

- Notes:

        Production should use a different JWT secret from Development.
        Production should use a separate database.
        Production should have its own frontend URL.

📊 Admin Access

Admin dashboard is available at:

/admin

### API Endpoints
        Public
        Health Check
        GET /api/health
        Submit Consent Form
        POST /api/consent
        Admin Authentication
        Login
        POST /api/admin/login

- Body:

    {
    "password": "admin-password"
    }

- Logout
        POST /api/admin/logout
        Session Check
        GET /api/admin/me
        Protected Admin Routes
        Dashboard Statistics
        GET /api/admin/dashboard
        Registrations
        GET /api/admin/registrations
        Delete Registration
        DELETE /api/admin/registrations/:id
        Export CSV
        GET /api/admin/registrations.csv


📦 Scripts
    Switch environments
        ./scripts/switch-env.sh dev
        ./scripts/switch-env.sh prod
    Release to production
        ./scripts/release-prod.sh

🔒 Future Improvements
    
    Role-based access
    Excel export (formatted)
    Email notifications
    Player search
    Audit logging
    Mobile UI enhancements

### License

- Private internal project.

- ot licensed for public redistribution.

- Developed for Wroughton & Wichelstowe Football Club.