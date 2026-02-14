export const OPENCLAW_DNS_RESOLVER_IP = "172.29.0.53";
export const OPENCLAW_NETWORK_SUBNET = "172.29.0.0/24";

export const OPENCLAW_FIREWALL_TABLE = "openclaw_secure";
export const OPENCLAW_FIREWALL_RULES_PATH = "/etc/openclaw/openclaw-firewall.nft";
export const OPENCLAW_FIREWALL_UNIT_NAME = "openclaw-secure-firewall.service";
export const OPENCLAW_FIREWALL_UNIT_PATH = `/etc/systemd/system/${OPENCLAW_FIREWALL_UNIT_NAME}`;
