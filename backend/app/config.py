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
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.thumb_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
