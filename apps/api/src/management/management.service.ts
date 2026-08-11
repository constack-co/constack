import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { In, Repository } from 'typeorm';
import type { UserRole } from '@constack/shared-types';
import type { AuthenticatedUser } from '../auth/auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import {
  Cluster,
  Incident,
  Integration,
  KubernetesEventRecord,
  OrganizationMembership,
  User,
  UserPreference,
} from '../persistence/entities.js';

interface CreateUserInput {
  email: string;
  displayName: string;
  password?: string;
  role: UserRole;
}
interface UpdateUserInput {
  active?: boolean;
  role?: UserRole;
}
interface IntegrationInput {
  type: string;
  name: string;
  enabled: boolean;
  configuration: Record<string, unknown>;
}
interface IntegrationUpdate {
  name?: string;
  enabled?: boolean;
  configuration?: Record<string, unknown>;
}
interface IncidentInput {
  title: string;
  severity: string;
  resourceIds: string[];
}
interface IncidentUpdate {
  title?: string;
  severity?: string;
  status?: string;
  resourceIds?: string[];
}

@Injectable()
export class ManagementService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(OrganizationMembership)
    private readonly membershipRepository: Repository<OrganizationMembership>,
    @InjectRepository(Cluster) private readonly clusterRepository: Repository<Cluster>,
    @InjectRepository(Integration) private readonly integrationRepository: Repository<Integration>,
    @InjectRepository(Incident) private readonly incidentRepository: Repository<Incident>,
    @InjectRepository(UserPreference)
    private readonly preferenceRepository: Repository<UserPreference>,
    @InjectRepository(KubernetesEventRecord)
    private readonly eventRepository: Repository<KubernetesEventRecord>,
    private readonly audit: AuditService,
  ) {}

  async users(organizationId: string) {
    const memberships = await this.membershipRepository.find({ where: { organizationId } });
    const users = memberships.length
      ? await this.userRepository.findBy({ id: In(memberships.map((item) => item.userId)) })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    return memberships.flatMap((membership) => {
      const user = byId.get(membership.userId);
      return user
        ? [
            {
              id: user.id,
              email: user.email,
              displayName: user.displayName,
              active: user.active,
              oidc: Boolean(user.oidcSubject),
              role: membership.role,
              createdAt: user.createdAt,
            },
          ]
        : [];
    });
  }

  async createUser(actor: AuthenticatedUser, input: CreateUserInput) {
    const email = input.email.toLowerCase();
    if (await this.userRepository.findOneBy({ email }))
      throw new ConflictException('A user with this email already exists');
    const user = await this.userRepository.save(
      this.userRepository.create({
        email,
        displayName: input.displayName,
        passwordHash: input.password
          ? await argon2.hash(input.password, { type: argon2.argon2id })
          : null,
        oidcSubject: null,
        active: true,
      }),
    );
    await this.membershipRepository.save(
      this.membershipRepository.create({
        organizationId: actor.organizationId,
        userId: user.id,
        role: input.role,
      }),
    );
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      eventType: 'user.create',
      targetId: user.id,
      outcome: 'succeeded',
      details: { email, role: input.role },
    });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      active: user.active,
      role: input.role,
      authentication: input.password ? 'local-or-oidc' : 'oidc-only',
    };
  }

  async updateUser(actor: AuthenticatedUser, id: string, input: UpdateUserInput) {
    const membership = await this.membershipRepository.findOneBy({
      organizationId: actor.organizationId,
      userId: id,
    });
    if (!membership) throw new NotFoundException('User membership not found');
    if (input.role) {
      membership.role = input.role;
      await this.membershipRepository.save(membership);
    }
    if (input.active !== undefined) await this.userRepository.update(id, { active: input.active });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      eventType: 'user.update',
      targetId: id,
      outcome: 'succeeded',
      details: { ...input },
    });
    return { ok: true };
  }

  clusters(organizationId: string) {
    return this.clusterRepository.find({ where: { organizationId }, order: { name: 'ASC' } });
  }
  integrations(organizationId: string) {
    return this.integrationRepository.find({ where: { organizationId }, order: { name: 'ASC' } });
  }

  async createIntegration(actor: AuthenticatedUser, input: IntegrationInput) {
    assertNoCredentialMaterial(input.configuration);
    const integration = await this.integrationRepository.save(
      this.integrationRepository.create({ ...input, organizationId: actor.organizationId }),
    );
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      eventType: 'integration.create',
      targetId: integration.id,
      outcome: 'succeeded',
      details: { type: input.type, enabled: input.enabled },
    });
    return integration;
  }

  async updateIntegration(actor: AuthenticatedUser, id: string, input: IntegrationUpdate) {
    const integration = await this.integrationRepository.findOneBy({
      id,
      organizationId: actor.organizationId,
    });
    if (!integration) throw new NotFoundException('Integration not found');
    if (input.configuration) assertNoCredentialMaterial(input.configuration);
    Object.assign(integration, input);
    const saved = await this.integrationRepository.save(integration);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      eventType: 'integration.update',
      targetId: id,
      outcome: 'succeeded',
      details: { enabled: saved.enabled },
    });
    return saved;
  }

  incidents(organizationId: string) {
    return this.incidentRepository.find({
      where: { organizationId },
      order: { updatedAt: 'DESC' },
      take: 200,
    });
  }

  async createIncident(actor: AuthenticatedUser, input: IncidentInput) {
    const incident = await this.incidentRepository.save(
      this.incidentRepository.create({
        ...input,
        organizationId: actor.organizationId,
        status: 'open',
      }),
    );
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      eventType: 'incident.create',
      targetId: incident.id,
      outcome: 'succeeded',
      details: { severity: input.severity },
    });
    return incident;
  }

  async updateIncident(actor: AuthenticatedUser, id: string, input: IncidentUpdate) {
    const incident = await this.incidentRepository.findOneBy({
      id,
      organizationId: actor.organizationId,
    });
    if (!incident) throw new NotFoundException('Incident not found');
    Object.assign(incident, input);
    const saved = await this.incidentRepository.save(incident);
    await this.audit.record({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      eventType: 'incident.update',
      targetId: id,
      outcome: 'succeeded',
      details: { ...input },
    });
    return saved;
  }

  async preference(userId: string, key: string) {
    if (!validPreferenceKey(key)) throw new NotFoundException('Preference not found');
    return (
      (await this.preferenceRepository.findOneBy({ userId, preferenceKey: key })) ?? {
        preferenceKey: key,
        value: null,
      }
    );
  }

  async savePreference(userId: string, key: string, value: unknown) {
    if (!validPreferenceKey(key)) throw new ConflictException('Preference key is invalid');
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 100_000)
      throw new ConflictException('Preference value is invalid or too large');
    let preference = await this.preferenceRepository.findOneBy({ userId, preferenceKey: key });
    preference ??= this.preferenceRepository.create({ userId, preferenceKey: key, value });
    preference.value = value;
    return this.preferenceRepository.save(preference);
  }

  events(organizationId: string, limit = 200) {
    return this.eventRepository.find({
      where: { organizationId },
      order: { observedAt: 'DESC' },
      take: Math.min(500, Math.max(1, limit)),
    });
  }
}

function validPreferenceKey(key: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,150}$/.test(key);
}

function assertNoCredentialMaterial(value: unknown, path = 'configuration'): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/(password|secret|token|authorization|api.?key|credential)/i.test(key)) {
      throw new ConflictException(
        `${path}.${key} cannot contain credentials; reference a Kubernetes Secret instead`,
      );
    }
    assertNoCredentialMaterial(nested, `${path}.${key}`);
  }
}
