from pydantic_settings import BaseSettings, SettingsConfigDict


from pydantic import model_validator


class Env(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./crtracker.db"
    secret_key: str  # required, no default: never ship a known signing key
    cookie_secure: bool = False  # set true behind HTTPS
    admin_email: str = ""
    admin_password: str = ""
    lab_provider: str = "mock"  # mock | thyrocare
    storage_dir: str = "./storage"
    file_encryption_key: str = ""  # Fernet key; generated per `python -m app.storage`
    llm_provider: str = "template"  # template (no AI, no key) | anthropic
    llm_model: str = "claude-sonnet-5-5"
    anthropic_api_key: str = ""
    # Shared secret the Cloudflare Worker adds to every request. When set, the backend refuses anything without it,
    # so nobody can bypass the Worker (and the client address it reports can be trusted). Empty = local development.
    edge_secret: str = ""
    # disk = encrypted files in STORAGE_DIR (local). db = encrypted files inside the database (free hosts have no disk).
    storage_backend: str = "disk"
    # browsers allowed to make state-changing requests; add the real site origin when hosting
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @model_validator(mode="after")
    def production_needs_a_strong_key(self):
        if self.cookie_secure and len(self.secret_key) < 32:  # COOKIE_SECURE=true is the "production" switch
            raise ValueError("SECRET_KEY must be at least 32 characters when COOKIE_SECURE=true")
        return self


env = Env()

# Admin-editable runtime settings; DB values override these (Part 3, 5.7, 8.5, 13.3).
SETTING_DEFAULTS = {
    "caller_can_view_results": False,
    "pull_time_ist": "07:00",
    "default_interval_days": 90,
    "max_call_attempts": 3,
    "attempt_window_days": 7,
    "timeout_escalation_hours": 4,
    "timeout_routine_hours": 24,
    "pilot_mode": False,
    "default_language": "en",
    "session_minutes": 30,
    "yearly_reengagement": False,
    "fetch_max_attempts": 3,
    "extraction_min_confidence_pct": 80,
    "identity_name_similarity_pct": 85,
    "company_name": "our health team",  # spoken in caller scripts (Q19: real brand/pitch wording pending)
    "caller_script_requires_approval": False,  # True = callers only see doctor-approved scripts
    "callcard_lead_days": 14,  # pre-generate cards this many days before the due date
}
