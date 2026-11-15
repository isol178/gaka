"""Gaka observer: turns rendered images into compact feedback for the Critic."""

from gaka_observer.metrics import Metrics, compute_metrics
from gaka_observer.views import change_bbox, crop, thumbnail

__all__ = ["Metrics", "change_bbox", "compute_metrics", "crop", "thumbnail"]
