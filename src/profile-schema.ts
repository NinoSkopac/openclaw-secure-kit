import { z } from "zod";

const DOMAIN_RE = /^[a-zA-Z0-9.-]+$/;

const DomainSchema = z
  .string()
  .min(1, "domain cannot be empty")
  .regex(DOMAIN_RE, "domain contains unsupported characters");

const PortSchema = z.number().int().min(1).max(65535);
const DirectIpPolicySchema = z.enum(["warn", "fail"]);
const EgressModeSchema = z.enum(["dns-allowlist", "proxy-only"]);

const NetworkSchema = z
  .object({
    egress_default: z.enum(["deny", "allow"]).default("deny"),
    allow: z.array(DomainSchema).default([]),
    allow_ports: z.array(PortSchema).default([]),
    direct_ip_policy: DirectIpPolicySchema.default("warn"),
    strict_ip_egress: z.boolean().optional(),
    egress_mode: EgressModeSchema.default("dns-allowlist")
  })
  .default({})
  .transform((network) => ({
    egress_default: network.egress_default,
    allow: network.allow,
    allow_ports: network.allow_ports,
    direct_ip_policy: network.strict_ip_egress === true ? "fail" : network.direct_ip_policy,
    egress_mode: network.strict_ip_egress === true ? "proxy-only" : network.egress_mode
  }));

export const ProfileSchema = z.object({
  openclaw: z.object({
    webui: z
      .object({
        enabled: z.boolean().default(false)
      })
      .default({}),
    gateway: z
      .object({
        public_listen: z.boolean().default(false),
        allow_unconfigured: z.boolean().default(true)
      })
      .default({}),
    approvals: z.object({
      exec: z.enum(["allow", "require", "deny"])
    })
  }),
  network: NetworkSchema
}).strip();

export type ProfileConfig = z.infer<typeof ProfileSchema>;
