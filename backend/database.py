from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

SQLALCHEMY_DATABASE_URL = "sqlite:///./nova.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Task(Base):
    __tablename__ = "tasks"
    id          = Column(Integer, primary_key=True, index=True)
    title       = Column(String, nullable=False)
    description = Column(String, nullable=True)
    completed   = Column(Boolean, default=False)
    priority    = Column(String, default="medium")
    created_at  = Column(DateTime, default=datetime.utcnow)
    due_date    = Column(String, nullable=True)


class Conversation(Base):
    """Every message ever said to / by NOVA — persisted across sessions."""
    __tablename__ = "conversations"
    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, nullable=False, index=True)
    role       = Column(String, nullable=False)   # "user" | "assistant"
    content    = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class NovaMemory(Base):
    """Key facts NOVA has learned about Mr. V over time."""
    __tablename__ = "nova_memory"
    id         = Column(Integer, primary_key=True, index=True)
    key        = Column(String, nullable=False, unique=True)
    value      = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow)


def create_tables():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
