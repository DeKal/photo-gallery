from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PHOTO_")

    database_url: str = "postgresql+psycopg://photo:photo@localhost:5432/photos"
    data_dir: Path = Path.home() / ".photo-app"
    thumb_dir: Optional[Path] = None

    def model_post_init(self, __context) -> None:
        if self.thumb_dir is None:
            self.thumb_dir = self.data_dir / "thumbs"
        # The worker writes thumbnails here; the slim API container never does
        # and may run on a read-only/ephemeral filesystem. Creating these dirs
        # is therefore best-effort: a failure must not break import of the
        # settings (and thus the API), since only the worker actually needs them.
        for directory in (self.data_dir, self.thumb_dir):
            try:
                directory.mkdir(parents=True, exist_ok=True)
            except OSError:
                pass


settings = Settings()
