import { INestApplication } from '@nestjs/common';
import request, { Response } from 'supertest';

export type TypedResponse<T> = Omit<Response, 'body'> & {
  body: T;
};

export async function post<TResponse>(
  app: INestApplication,
  url: string,
  token: string,
  payload: unknown,
): Promise<TypedResponse<TResponse>> {
  const httpServer = app.getHttpServer() as unknown as Parameters<
    typeof request
  >[0];
  const response = await request(httpServer)
    .post(url)
    .set('Authorization', `Bearer ${token}`)
    .send(payload as string | object | undefined);

  return response;
}

export async function postPublic<TResponse>(
  app: INestApplication,
  url: string,
  payload: unknown,
): Promise<TypedResponse<TResponse>> {
  const httpServer = app.getHttpServer() as unknown as Parameters<
    typeof request
  >[0];
  const response = await request(httpServer)
    .post(url)
    .send(payload as string | object | undefined);

  return response;
}

export async function get<TResponse>(
  app: INestApplication,
  url: string,
  token: string,
): Promise<TypedResponse<TResponse>> {
  const httpServer = app.getHttpServer() as unknown as Parameters<
    typeof request
  >[0];
  const response = await request(httpServer)
    .get(url)
    .set('Authorization', `Bearer ${token}`);

  return response;
}

export async function getPublic<TResponse>(
  app: INestApplication,
  url: string,
): Promise<TypedResponse<TResponse>> {
  const httpServer = app.getHttpServer() as unknown as Parameters<
    typeof request
  >[0];
  const response = await request(httpServer).get(url);

  return response;
}

export async function put<TResponse>(
  app: INestApplication,
  url: string,
  token: string,
  payload: unknown,
): Promise<TypedResponse<TResponse>> {
  const httpServer = app.getHttpServer() as unknown as Parameters<
    typeof request
  >[0];
  const response = await request(httpServer)
    .put(url)
    .set('Authorization', `Bearer ${token}`)
    .send(payload as string | object | undefined);

  return response;
}

export async function del<TResponse>(
  app: INestApplication,
  url: string,
  token: string,
): Promise<TypedResponse<TResponse>> {
  const httpServer = app.getHttpServer() as unknown as Parameters<
    typeof request
  >[0];
  const response = await request(httpServer)
    .delete(url)
    .set('Authorization', `Bearer ${token}`);

  return response;
}

export async function patch<TResponse>(
  app: INestApplication,
  url: string,
  token: string,
  payload: unknown,
): Promise<TypedResponse<TResponse>> {
  const httpServer = app.getHttpServer() as unknown as Parameters<
    typeof request
  >[0];
  const response = await request(httpServer)
    .patch(url)
    .set('Authorization', `Bearer ${token}`)
    .send(payload as string | object | undefined);

  return response;
}
