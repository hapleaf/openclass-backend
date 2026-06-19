import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { verifyToken } from '../helpers/jwt.helper';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');
    try {
      const payload = verifyToken<{ sub: number; email: string; role: string }>(auth.slice(7));
      if (payload.role !== 'admin') throw new ForbiddenException('Admin access required');
      req.user = payload;
      return true;
    } catch (err: unknown) {
      if (err instanceof ForbiddenException) throw err;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
