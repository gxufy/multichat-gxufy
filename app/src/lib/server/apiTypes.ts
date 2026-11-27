/*
 * What an API handler in app/src/api is given: Node's own request and
 * response, plus what the web app's route adapter adds to them
 * (web/src/lib/server/apiRoute.ts): the query, the cookies and the parsed body
 * on the request; status(), json(), send() and redirect() on the response.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ApiRequest extends IncomingMessage {
  /** The query string's values; a repeated key gives an array. */
  query: Partial<Record<string, string | string[]>>;
  /** The Cookie header's values. */
  cookies: Partial<Record<string, string>>;
  /** The body: parsed JSON, form or text, or undefined when the route reads it itself. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiResponse<Data = any> = ServerResponse & {
  /** A string, Buffer, stream or JSON value, with its content type and ETag. */
  send: (body: Data) => void;
  /** A JSON value. */
  json: (body: Data) => void;
  status: (statusCode: number) => ApiResponse<Data>;
  redirect(url: string): ApiResponse<Data>;
  redirect(status: number, url: string): ApiResponse<Data>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiHandler<Data = any> = (req: ApiRequest, res: ApiResponse<Data>) => unknown | Promise<unknown>;
