#!/usr/bin/env bash
# =============================================================================
#  Installation d'Estim'Immo sur un VPS (Debian/Ubuntu) déjà équipé de Caddy.
#  À lancer en root, depuis le dossier du dépôt cloné :
#      sudo bash deploy/install.sh
#  Ce que fait le script :
#   1. copie le site dans /var/www/estim-immo
#   2. demande un domaine, un identifiant et un mot de passe → bloc Caddy avec basic_auth
#   3. crée un utilisateur "estimdeploy" + clé SSH pour que GitHub Actions
#      puisse pousser les mises à jour (site + données DVF) automatiquement
#  Le script ne touche pas aux autres sites de votre Caddyfile.
# =============================================================================
set -euo pipefail

DEST=/var/www/estim-immo
SITE_CONF=/etc/caddy/sites/estim-immo.caddy
CADDYFILE=/etc/caddy/Caddyfile
DEPLOY_USER=estimdeploy
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
command -v caddy >/dev/null || { echo "Caddy n'est pas installé (voir https://caddyserver.com/docs/install)."; exit 1; }
[ -f "$SOURCE/index.html" ] || { echo "Lancez le script depuis le dossier du dépôt (index.html introuvable)."; exit 1; }

etape() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

etape "1/4  Domaine et accès"
read -rp "Nom de domaine du site (ex. estim.fpt-pratique.fr) : " DOMAINE
[ -n "$DOMAINE" ] || { echo "Domaine requis."; exit 1; }
read -rp "Identifiant de connexion [wissam] : " UTILISATEUR
UTILISATEUR=${UTILISATEUR:-wissam}
while true; do
  read -rsp "Mot de passe : " MDP; echo
  read -rsp "Confirmer    : " MDP2; echo
  [ "$MDP" = "$MDP2" ] && [ ${#MDP} -ge 8 ] && break
  echo "Les mots de passe diffèrent ou font moins de 8 caractères, recommencez."
done
HASH="$(caddy hash-password --plaintext "$MDP")"
unset MDP MDP2

RESOLU="$(getent ahostsv4 "$DOMAINE" | awk 'NR==1{print $1}' || true)"
IP_VPS="$(curl -4 -s --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
if [ "$RESOLU" = "$IP_VPS" ]; then echo "OK : $DOMAINE pointe vers ce serveur ($IP_VPS)."
else echo "ATTENTION : $DOMAINE pointe vers '${RESOLU:-rien}' et ce serveur a l'IP $IP_VPS. Créez un enregistrement DNS A $DOMAINE → $IP_VPS (IONOS). Le HTTPS marchera une fois le DNS propagé."; fi

etape "2/4  Copie du site"
mkdir -p "$DEST"
rsync -a --delete --exclude .git --exclude .github --exclude deploy --exclude test --exclude scripts "$SOURCE/" "$DEST/"
echo "Site copié dans $DEST ($(du -sh "$DEST" | cut -f1))."

etape "3/4  Configuration Caddy"
mkdir -p /etc/caddy/sites /var/log/caddy
sed -e "s|__DOMAINE__|$DOMAINE|" -e "s|__DEST__|$DEST|" -e "s|__UTILISATEUR__|$UTILISATEUR|" -e "s|__HASH__|$HASH|" \
  "$SOURCE/deploy/estim-immo.caddy" > "$SITE_CONF"
if ! grep -qE '^\s*import\s+/etc/caddy/sites/\*' "$CADDYFILE" 2>/dev/null; then
  cp "$CADDYFILE" "$CADDYFILE.sauvegarde.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
  printf '\n# Sites supplémentaires (un fichier par site)\nimport /etc/caddy/sites/*.caddy\n' >> "$CADDYFILE"
fi
caddy validate --config "$CADDYFILE" --adapter caddyfile
systemctl reload caddy
chown -R caddy:caddy /var/log/caddy 2>/dev/null || true
echo "Caddy rechargé : https://$DOMAINE (identifiant $UTILISATEUR)."

etape "4/4  Déploiement automatique depuis GitHub (facultatif)"
read -rp "Créer l'utilisateur $DEPLOY_USER et une clé SSH pour GitHub Actions ? [O/n] : " REP
if [[ "${REP:-O}" =~ ^[OoYy]$ ]]; then
  id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
  chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$DEST"
  KEYDIR="/home/$DEPLOY_USER/.ssh"; mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"
  KEY="$KEYDIR/github_actions"
  if [ ! -f "$KEY" ]; then
    ssh-keygen -t ed25519 -N "" -C "github-actions estim-immo" -f "$KEY" >/dev/null
    # Clé limitée : pas de shell interactif, pas de redirection de port
    printf 'restrict,command="%s" %s\n' "$DEST/../estim-rrsync.sh" "$(cat "$KEY.pub")" > "$KEYDIR/authorized_keys" 2>/dev/null || true
    # rrsync n'est pas toujours disponible : on autorise simplement rsync via un wrapper
    cat > "$DEST/../estim-rrsync.sh" <<EOF
#!/bin/sh
# Autorise uniquement rsync vers $DEST pour la clé GitHub Actions
case "\$SSH_ORIGINAL_COMMAND" in
  rsync\ --server*) exec \$SSH_ORIGINAL_COMMAND ;;
  *) echo "Commande refusée" >&2; exit 1 ;;
esac
EOF
    chmod 755 "$DEST/../estim-rrsync.sh"
    chmod 600 "$KEYDIR/authorized_keys"; chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$KEYDIR"
  fi
  echo
  echo "Ajoutez ces 4 secrets dans GitHub : dépôt → Settings → Secrets and variables → Actions → New repository secret"
  echo "  VPS_HOST    = $IP_VPS"
  echo "  VPS_USER    = $DEPLOY_USER"
  echo "  VPS_PATH    = $DEST"
  echo "  VPS_SSH_KEY = le contenu COMPLET ci-dessous (clé privée, à ne partager avec personne d'autre que GitHub) :"
  echo "-----------------------------------------------------------------------------"
  cat "$KEY"
  echo "-----------------------------------------------------------------------------"
  echo "Ensuite : onglet Actions → « Déploiement sur le VPS » → Run workflow. À chaque mise à jour, le site est envoyé automatiquement."
fi

printf '\n\033[1mTerminé.\033[0m Ouvrez https://%s et connectez-vous avec l\x27identifiant %s.\n' "$DOMAINE" "$UTILISATEUR"
echo "Pour changer le mot de passe plus tard : caddy hash-password, puis remplacez l'empreinte dans $SITE_CONF et faites systemctl reload caddy."
