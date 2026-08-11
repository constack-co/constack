import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import * as oidc from 'openid-client';
import { randomBytes } from 'node:crypto';
import { loadRuntimeConfig } from '@constack/config';
import { Organization, OrganizationMembership, User } from '../persistence/entities.js';
import { RedisService } from '../common/redis.service.js';
import type { AuthenticatedUser } from './auth.decorators.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly config = loadRuntimeConfig();
  private oidcConfiguration?: oidc.Configuration;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationMembership)
    private readonly memberships: Repository<OrganizationMembership>,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    let organization = await this.organizations.findOneBy({ slug: 'default' });
    if (!organization)
      organization = await this.organizations.save(
        this.organizations.create({ name: this.config.BOOTSTRAP_ORGANIZATION, slug: 'default' }),
      );
    let user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: this.config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() })
      .getOne();
    if (!user) {
      user = await this.users.save(
        this.users.create({
          email: this.config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
          displayName: 'ConStack Administrator',
          passwordHash: await argon2.hash(this.config.BOOTSTRAP_ADMIN_PASSWORD, {
            type: argon2.argon2id,
          }),
          oidcSubject: null,
          active: true,
        }),
      );
    }
    const membership = await this.memberships.findOneBy({
      organizationId: organization.id,
      userId: user.id,
    });
    if (!membership)
      await this.memberships.save(
        this.memberships.create({
          organizationId: organization.id,
          userId: user.id,
          role: 'administrator',
        }),
      );
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ sessionId: string; user: AuthenticatedUser }> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
    if (!user?.active || !user.passwordHash || !(await argon2.verify(user.passwordHash, password)))
      throw new UnauthorizedException('Invalid credentials');
    return this.createSession(user);
  }

  async createSession(user: User): Promise<{ sessionId: string; user: AuthenticatedUser }> {
    const membership = await this.memberships.findOneBy({ userId: user.id });
    if (!membership) throw new UnauthorizedException('No organization membership');
    const sessionId = randomBytes(32).toString('base64url');
    const authenticated: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      organizationId: membership.organizationId,
      role: membership.role,
      csrfToken: randomBytes(24).toString('base64url'),
    };
    await this.redis.client.set(
      `session:${sessionId}`,
      JSON.stringify(authenticated),
      'EX',
      60 * 60 * 12,
    );
    return { sessionId, user: authenticated };
  }

  async getSession(sessionId: string): Promise<AuthenticatedUser | undefined> {
    const raw = await this.redis.client.get(`session:${sessionId}`);
    if (!raw) return undefined;
    await this.redis.client.expire(`session:${sessionId}`, 60 * 60 * 12);
    return JSON.parse(raw) as AuthenticatedUser;
  }

  async logout(sessionId: string): Promise<void> {
    await this.redis.client.del(`session:${sessionId}`);
  }

  oidcEnabled(): boolean {
    return Boolean(
      this.config.OIDC_ISSUER_URL && this.config.OIDC_CLIENT_ID && this.config.OIDC_REDIRECT_URL,
    );
  }

  async beginOidc(): Promise<string> {
    const configuration = await this.getOidcConfiguration();
    const verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    await this.redis.client.set(`oidc:${state}`, JSON.stringify({ verifier, nonce }), 'EX', 600);
    return oidc
      .buildAuthorizationUrl(configuration, {
        redirect_uri: this.config.OIDC_REDIRECT_URL!,
        scope: 'openid email profile',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        nonce,
      })
      .toString();
  }

  async finishOidc(
    currentUrl: URL,
    state: string,
  ): Promise<{ sessionId: string; user: AuthenticatedUser }> {
    const stored = await this.redis.client.getdel(`oidc:${state}`);
    if (!stored) throw new UnauthorizedException('OIDC state expired');
    let transaction: { verifier: string; nonce: string };
    try {
      transaction = JSON.parse(stored) as { verifier: string; nonce: string };
      if (!transaction.verifier || !transaction.nonce) throw new Error('Invalid OIDC transaction');
    } catch {
      throw new UnauthorizedException('OIDC transaction is invalid');
    }
    const configuration = await this.getOidcConfiguration();
    const tokens = await oidc.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: transaction.verifier,
      expectedState: state,
      expectedNonce: transaction.nonce,
    });
    const claims = tokens.claims();
    const email = typeof claims?.email === 'string' ? claims.email.toLowerCase() : undefined;
    if (!claims?.sub || !email)
      throw new UnauthorizedException('OIDC provider did not return email and subject');
    const allowed = this.config.OIDC_ALLOWED_DOMAINS.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (allowed.length && !allowed.some((domain) => email.endsWith(`@${domain}`)))
      throw new UnauthorizedException('Email domain is not allowed');
    const subject = `${this.config.OIDC_ISSUER_URL}|${claims.sub}`;
    const user = await this.users.findOne({ where: [{ oidcSubject: subject }, { email }] });
    if (!user)
      throw new UnauthorizedException('This account has not been provisioned by an administrator');
    if (!user.active) throw new UnauthorizedException('This account is disabled');
    if (user.oidcSubject && user.oidcSubject !== subject)
      throw new UnauthorizedException('This account is linked to a different OIDC identity');
    if (!user.oidcSubject) {
      await this.users.update(user.id, { oidcSubject: subject });
      user.oidcSubject = subject;
    }
    const membership = await this.memberships.findOneBy({ userId: user.id });
    if (!membership) throw new UnauthorizedException('No organization membership');
    return this.createSession(user);
  }

  private async getOidcConfiguration(): Promise<oidc.Configuration> {
    if (!this.oidcEnabled()) throw new UnauthorizedException('OIDC is not configured');
    this.oidcConfiguration ??= await oidc.discovery(
      new URL(this.config.OIDC_ISSUER_URL!),
      this.config.OIDC_CLIENT_ID!,
      this.config.OIDC_CLIENT_SECRET,
    );
    return this.oidcConfiguration;
  }
}
