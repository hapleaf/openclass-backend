import * as jwt from 'jsonwebtoken';

export function signToken(payload: object, expires = '7d') {
  return jwt.sign(payload, process.env.JWT_SECRET || 'dev', { expiresIn: expires });
}

export function verifyToken<T = any>(token: string): T {
  return jwt.verify(token, process.env.JWT_SECRET || 'dev') as T;
}
