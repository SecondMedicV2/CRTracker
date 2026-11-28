# Design Note: Health360 Patient Portal (Phase B)

## Overview
The Health360 Patient Portal provides enrolled patients (starting with H360_FREE and paid tiers) secure access to their digital health records, lab reports, trend comparisons, medicine reminders, and health alerts.

## Proposed Architecture
1. **Authentication & Authorization**:
   - New `patient` role in authentication.
   - OTP-based login to registered mobile number (rate-limited, cryptographic hash of OTP, 10-minute expiry).
   - JWT session cookie with HttpOnly, Secure, SameSite=Lax.
2. **Data Isolation & Privacy**:
   - Patients can view **only** their own encrypted reports and records (field-level decryption on demand).
   - Strict server-side validation ensuring tenant/patient isolation.
3. **Core Features**:
   - **My Health Records**: Decrypted lab reports, parameter trends (Page 10), and doctor insights.
   - **Reminders & Alerts**: Refill reminders, retest due dates, and care plan touchpoints.
   - **Consent Management**: Granular consent tracking for family linking and data sharing.

*Status: Awaiting approval before implementation.*
