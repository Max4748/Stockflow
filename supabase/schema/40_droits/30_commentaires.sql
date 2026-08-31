-- ============================================================
-- StockFlow — Commentaires embarqués
-- ============================================================

comment on column profils.commission_unitaire is
  'Valeur COURANTE. La valeur historique d''une vente est figée dans vente_lignes.';

comment on function est_admin() is
  'Vrai si l''appelant est un admin ACTIF. Le rôle seul ne suffit jamais.';

comment on function transferer_stock(uuid, jsonb, text) is
  'Transfert entrepôt → détenteur, sans demande préalable. Aucun filtre de rôle : un compte d''encadrement peut détenir du stock et vendre.';

comment on column profils.sav_vu_le is
  'Dernière ouverture de l''écran SAV par ce compte. Sert uniquement à la pastille de nouveauté, jamais à une décision d''autorisation.';

comment on column profils.sav_gestion_vu_le is
  'Dernière ouverture de l''écran Gestion → SAV. Sert uniquement à la pastille de nouveauté, jamais à une décision d''autorisation.';

comment on function retirer_produit(uuid) is
  'Supprime un produit jamais employé, désactive celui qui a un historique. Renvoie le message à afficher.';

comment on function annuler_invitation(text) is
  'Retire une invitation NON consommée. Garde volontairement plus faible que inviter_utilisateur : retirer ne peut élever personne.';

comment on function retirer_compte(uuid) is
  'Supprime un compte sans aucune trace, désactive celui qui a un historique. Renvoie le message à afficher.';

comment on column profils.stock_lie_entrepot is
  'Vrai quand l''entrepôt EST le stock de ce compte : ses ventes y puisent directement. Réservé à l''encadrement.';

comment on table journal_admin is
  'Trace des actions d''administration de comptes. Écriture par tracer_admin() uniquement, lecture réservée au dev.';

comment on table ip_bloquees is
  'Palier 3 de l''anti-bourrage. jusqu_a NULL = blocage définitif, posé à la main.';

-- Le commentaire de la fonction porte la règle là où on la lit : dans
-- `\df+ bloquer_ip`, pas seulement dans un fichier du dépôt.
comment on function bloquer_ip(text, text) is
  'Palier 3 de l''anti-bourrage. Réservée à service_role : le paramètre p_ip est choisi par l''appelant, l''ouvrir à anon permettait de bloquer une adresse arbitraire, dev compris.';

comment on table journal_operations is
  'Trace des opérations qui effacent ou corrigent une écriture. Le journal comptable étant dérivé de l''état courant, sans elle une suppression est invisible.';

comment on function reinitialiser_donnees(text) is
  'Vide les données d''activité, conserve comptes, invitations, blocages IP et journal d''administration. Réservée au dev, exige la phrase REINITIALISER.';

comment on function reinitialiser_donnees(text) is
  'Vide les données d''activité, conserve comptes, invitations, blocages IP et journal d''administration. Réservée au dev (seul verrou d''autorisation) ; la confirmation attendue est le nombre de lignes à effacer, garde-fou contre l''erreur d''instance.';
