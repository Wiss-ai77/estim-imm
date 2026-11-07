#!/usr/bin/env bash
# =============================================================================
#  Installation d'Estim'Immo derrière nginx (quand nginx sert déjà d'autres sites).
#  À lancer en root depuis le dossier du dépôt :  sudo bash deploy/install-nginx.sh
#   1. copie le site dans /var/www/estim-immo
#   2. mot de passe (htpasswd) + site nginx + certificat Let's Encrypt (certbot)
#   3. retire Caddy s'il avait été installé par deploy/install.sh
#   4. utilisateur "estimdeploy" + clé SSH pour le déploiement automatique GitHub
# =============================================================================
set -euo pipefail

DEST=/var/www/estim-immo
SITE=/etc/nginx/sites-available/estim-immo
HTPASSWD=/etc/nginx/estim-immo.htpasswd
DEPLOY_USER=estimdeploy
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
[ -f "$SOURCE/index.html" ] || { echo "Lancez le script depuis le dossier du dépôt."; exit 1; }
command -v nginx >/dev/null || { echo "nginx n'est pas installé ; utilisez deploy/install.sh (Caddy)."; exit 1; }
etape() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

etape "0/4  Logiciels (rsync, certbot, apache2-utils)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq rsync curl apache2-utils certbot python3-certbot-nginx >/dev/null
if systemctl is-enabled --quiet caddy 2>/dev/null || systemctl is-active --quiet caddy 2>/dev/null; then
  systemctl disable --now caddy >/dev/null 2>&1 || true
  echo "Caddy désactivé (nginx garde les ports 80/443)."
fi

etape "1/4  Domaine et accès"
IP_VPS="$(curl -4 -s --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
read -rp "Nom de domaine du site, par exemple estim.fpt-pratique.fr : " DOMAINE
DOMAINE="$(printf '%s' "$DOMAINE" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s/[^a-z0-9.-]//g')"
[ -n "$DOMAINE" ] || { echo "Un nom de domaine est nécessaire avec nginx + Let's Encrypt."; exit 1; }
read -rp "Identifiant de connexion [wissam] : " UTILISATEUR
UTILISATEUR=${UTILISATEUR:-wissam}
while true; do
  read -rsp "Mot de passe : " MDP; echo
  read -rsp "Confirmer    : " MDP2; echo
  [ "$MDP" = "$MDP2" ] && [ ${#MDP} -ge 8 ] && break
  echo "Les mots de passe diffèrent ou font moins de 8 caractères, recommencez."
done
htpasswd -bBc "$HTPASSWD" "$UTILISATEUR" "$MDP" >/dev/null
unset MDP MDP2
chmod 640 "$HTPASSWD"; chown root:www-data "$HTPASSWD"
RESOLU="$(getent ahostsv4 "$DOMAINE" | awk 'NR==1{print $1}' || true)"
if [ "$RESOLU" = "$IP_VPS" ]; then echo "OK : $DOMAINE pointe vers ce serveur ($IP_VPS)."
else echo "ATTENTION : $DOMAINE pointe vers '${RESOLU:-rien}' (serveur : $IP_VPS). Le certificat sera demandé quand le DNS sera propagé."; fi

etape "2/4  Copie du site"
mkdir -p "$DEST"
rsync -a --delete --exclude .git --exclude .github --exclude deploy --exclude test --exclude scripts "$SOURCE/" "$DEST/"
chmod -R u=rwX,go=rX "$DEST"
echo "Site copié dans $DEST ($(du -sh "$DEST" | cut -f1))."

etape "3/4  nginx + HTTPS"
sed -e "s|__DOMAINE__|$DOMAINE|" -e "s|__DEST__|$DEST|" "$SOURCE/deploy/estim-immo.nginx" > "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/estim-immo
nginx -t
systemctl reload nginx
echo "nginx rechargé : http://$DOMAINE"
if [ "$RESOLU" = "$IP_VPS" ]; then
  EMAIL_OPT="--register-unsafely-without-email"
  [ -d /etc/letsencrypt/accounts ] && EMAIL_OPT=""
  if certbot --nginx -d "$DOMAINE" --non-interactive --agree-tos --redirect $EMAIL_OPT; then
    echo "Certificat Let's Encrypt installé : https://$DOMAINE"
  else
    echo "Certbot a échoué (souvent : DNS pas encore propagé). Relancez plus tard :  sudo certbot --nginx -d $DOMAINE --redirect"
  fi
else
  echo "DNS non propagé : relancez plus tard  sudo certbot --nginx -d $DOMAINE --redirect  pour activer le HTTPS."
fi

etape "4/4  Déploiement automatique depuis GitHub (facultatif)"
read -rp "Créer l'utilisateur $DEPLOY_USER et une clé SSH pour GitHub Actions ? [O/n] : " REP
if [[ "${REP:-O}" =~ ^[OoYy]$ ]]; then
  id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
  chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$DEST"
  KEYDIR="/home/$DEPLOY_USER/.ssh"; mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"
  KEY="$KEYDIR/github_actions"
  if [ ! -f "$KEY" ]; then
    ssh-keygen -t ed25519 -N "" -C "github-actions estim-immo" -f "$KEY" >/dev/null
    cat > /var/www/estim-rrsync.sh <<EOF
#!/bin/sh
# Autorise uniquement rsync vers $DEST pour la clé GitHub Actions
case "\$SSH_ORIGINAL_COMMAND" in
  rsync\ --server*) exec \$SSH_ORIGINAL_COMMAND ;;
  *) echo "Commande refusée" >&2; exit 1 ;;
esac
EOF
    chmod 755 /var/www/estim-rrsync.sh
    printf 'restrict,command="/var/www/estim-rrsync.sh" %s\n' "$(cat "$KEY.pub")" > "$KEYDIR/authorized_keys"
    chmod 600 "$KEYDIR/authorized_keys"; chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$KEYDIR"
  fi
  echo
  echo "Ajoutez ces 4 secrets dans GitHub : dépôt → Settings → Secrets and variables → Actions → New repository secret"
  echo "  VPS_HOST    = $IP_VPS"
  echo "  VPS_USER    = $DEPLOY_USER"
  echo "  VPS_PATH    = $DEST"
  echo "  VPS_SSH_KEY = le contenu COMPLET ci-dessous (clé privée, à ne donner qu'à GitHub) :"
  echo "-----------------------------------------------------------------------------"
  cat "$KEY"
  echo "-----------------------------------------------------------------------------"
fi

printf '\n\033[1mTerminé.\033[0m Ouvrez https://%s (identifiant %s).\n' "$DOMAINE" "$UTILISATEUR"
echo "Changer le mot de passe : sudo htpasswd -B $HTPASSWD $UTILISATEUR"
