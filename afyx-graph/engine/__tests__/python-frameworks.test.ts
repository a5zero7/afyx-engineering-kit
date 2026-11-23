import { describe, it, expect } from 'vitest';
import { djangoResolver, fastapiResolver } from '../src/resolution/frameworks/python';

describe('AFYX-219: Django and FastAPI Graph Intelligence', () => {
  it('extracts Django URL patterns, ViewSets, and Model relations', () => {
    const djangoSource = `
from django.urls import path
from django.db import models
from rest_framework import routers

class Author(models.Model):
    name = models.CharField(max_length=100)

class Article(models.Model):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(Author, on_delete=models.CASCADE)
    tags = models.ManyToManyField('Tag')

urlpatterns = [
    path('articles/', views.article_list, name='article-list'),
]

router = routers.DefaultRouter()
router.register(r'authors', views.AuthorViewSet)
`;

    const result = djangoResolver.extract!('myapp/views.py', djangoSource);

    // Verify route nodes
    const routeNodes = result.nodes.filter((n) => n.kind === 'route');
    expect(routeNodes.map((n) => n.name)).toContain('articles/');
    expect(routeNodes.map((n) => n.name)).toContain('VIEWSET /authors');

    // Verify model nodes
    const modelNodes = result.nodes.filter((n) => n.kind === 'class');
    expect(modelNodes.map((n) => n.name)).toContain('Author');
    expect(modelNodes.map((n) => n.name)).toContain('Article');

    // Verify model relation fields
    const fieldNodes = result.nodes.filter((n) => n.kind === 'field');
    expect(fieldNodes.map((n) => n.name)).toContain('author');
    expect(fieldNodes.map((n) => n.name)).toContain('tags');

    // Verify references to related models
    const authorRef = result.references.find((r) => r.referenceName === 'Author');
    expect(authorRef).toBeDefined();

    const tagRef = result.references.find((r) => r.referenceName === 'Tag');
    expect(tagRef).toBeDefined();
  });

  it('extracts FastAPI routes, handler functions, and Depends injection bindings', () => {
    const fastapiSource = `
from fastapi import FastAPI, Depends, APIRouter
from .deps import get_db, get_current_user

app = FastAPI()
router = APIRouter(prefix="/v1")

@app.get("/users/me")
async def read_users_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return current_user

@router.post("/items")
def create_item(item: Item, db: Session = Depends(get_db)):
    return item
`;

    const result = fastapiResolver.extract!('api/main.py', fastapiSource);

    const routeNodes = result.nodes.filter((n) => n.kind === 'route');
    expect(routeNodes.map((n) => n.name)).toContain('GET /users/me');
    expect(routeNodes.map((n) => n.name)).toContain('POST /items');

    // Verify handler function references
    const handlerRefs = result.references.map((r) => r.referenceName);
    expect(handlerRefs).toContain('read_users_me');
    expect(handlerRefs).toContain('create_item');

    // Verify Depends injection references
    expect(handlerRefs).toContain('get_current_user');
    expect(handlerRefs).toContain('get_db');
  });
});
