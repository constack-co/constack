import { Body, Controller, Get, Post, Query, Redirect, Req, Res } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public, type AuthenticatedUser } from './auth.decorators.js';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body.email, body.password);
    this.setCookie(request, response, result.sessionId);
    return { user: result.user, csrfToken: result.user.csrfToken };
  }

  @Get('session')
  session(@CurrentUser() user: AuthenticatedUser) {
    return { user, csrfToken: user.csrfToken, oidcEnabled: this.auth.oidcEnabled() };
  }

  @Get('options')
  @Public()
  options() {
    return { localAuthentication: true, oidcEnabled: this.auth.oidcEnabled(), publicSignup: false };
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const sessionId = request.cookies?.constack_session as string | undefined;
    if (sessionId) await this.auth.logout(sessionId);
    response.clearCookie('constack_session', { path: '/' });
    return { ok: true };
  }

  @Get('oidc/start')
  @Public()
  @Redirect()
  async startOidc() {
    return { url: await this.auth.beginOidc(), statusCode: 302 };
  }

  @Get('oidc/callback')
  @Public()
  async finishOidc(
    @Req() request: Request,
    @Res() response: Response,
    @Query('state') state: string,
  ) {
    const forwardedProto = request.header('x-forwarded-proto') ?? request.protocol;
    const forwardedHost = request.header('x-forwarded-host') ?? request.header('host');
    const currentUrl = new URL(request.originalUrl, `${forwardedProto}://${forwardedHost}`);
    const result = await this.auth.finishOidc(currentUrl, state);
    this.setCookie(request, response, result.sessionId);
    response.redirect('/');
  }

  private setCookie(request: Request, response: Response, sessionId: string): void {
    response.cookie('constack_session', sessionId, {
      httpOnly: true,
      secure: request.secure,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1_000,
      path: '/',
    });
  }
}
