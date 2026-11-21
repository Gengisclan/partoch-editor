Partoch editor
==============

Télécharger : https://github.com/Gengisclan/partoch-editor/releases/latest

Éditeur de partitions personnel, pensé pour la flûte à bec (soprano, alto, ténor et basse) et le piano.

Installer
---------

Deux fichiers, sur la page Releases du dépôt :

- Installer-Partoch-editor.exe (petit) : télécharge puis installe l'application, avec un raccourci sur le Bureau. Les partitions vont dans Documents\Partoch.
- Partoch-editor-portable.exe : rien à installer, se lance d'un double-clic, par exemple depuis une clé USB. Les partitions (Partitions\) et les réglages (Partoch - données\) restent à côté du fichier, sur la clé.

Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » (l'application n'est pas signée) : Informations complémentaires → Exécuter quand même.

Le scan de partitions demande en plus Audiveris : l'application propose de le télécharger la première fois.

Depuis les sources : npm install puis npm start. npm run dist fabrique les deux fichiers dans dist\.

Une sauvegarde automatique est faite en continu : si l'appli se ferme mal, la partition revient au prochain lancement.

L'écran
-------

- En haut à gauche : le menu Fichier (nouveau, ouvrir, scanner, enregistrer, exporter, parties séparées, mise en page, imprimer), le menu Édition (couper, copier, coller, doubler ou diviser les durées, répéter la sélection, aller à la mesure), puis ouvrir, enregistrer, annuler et rétablir.
- Au centre : la lecture (début, lecture/pause, boucle, métronome, décompte, pistes), le tempo et la vitesse d'entraînement.
- En haut à droite : Micro, Transposer, Partition (titre, instruments, tonalité…) et la roue dentée Paramètres.
- Deuxième ligne, la barre d'écriture : Sélection / Écriture, les durées, les silences, triolets, petites notes et accords, les voix, les altérations, les liaisons, puis six menus (nuances, articulations, ornements, reprises, tempo, texte) et les mesures. Passez la souris sur un bouton pour voir son nom et son raccourci.
- En bas à droite : le diapason ouvre l'accordeur (note jouée et écart en cents, La 440, 442, 415 ou 392), puis le zoom.
- La partition s'affiche sur des feuilles A4, comme à l'impression : un système n'est jamais coupé entre deux pages. Un titre trop long passe à la ligne.

Raccourcis clavier
------------------

Paramètres (roue dentée, en haut à droite) liste toutes les actions avec leur touche. Cliquez sur une touche puis appuyez sur la nouvelle combinaison (Échap annule, Retour arrière retire la touche). Une touche déjà prise est retirée de l'autre action. Les lettres A à G (écriture des notes au clavier), Échap, Suppr et Entrée ne peuvent pas être attribuées. La flèche à droite d'une ligne remet la touche d'origine, Tout rétablir remet toutes les touches d'origine.

Écrire des notes
----------------

1. Cliquez sur ✎ Écriture (ou appuyez sur N).
2. Choisissez une durée dans la palette (ronde → triple croche, avec • pour une note pointée).
3. Cliquez sur la portée. Une note fantôme bleue montre où la note sera posée. Elle devient rouge si la note est hors tessiture.

| Action | Souris | Clavier |
|---|---|---|
| Placer une note | Clic | A à G (notation anglaise) |
| Ajouter une note à un accord | bouton Accord (trois notes empilées) puis clic sur la note, ou Maj + clic | un clic sur une note de l'accord la retire |
| Effacer une note | Clic droit | Suppr |
| Corriger la dernière note | | ↑ ↓ (demi-ton), Ctrl+↑↓ (octave), Alt+↑↓ (degré) |
| Dièse / bémol / bécarre | Boutons ♯ ♭ ♮ (barre d'écriture) | |
| Silence | Bouton silence, puis clic | 0 |
| Liaison de prolongation | Bouton aux deux notes reliées (sur une note, ou sur plusieurs avec Maj+clic) | T |
| Durées | Palette | 2 triple croche … 5 noire, 6 blanche, 7 ronde, . point |

Liaisons et respirations
------------------------

Trois signes, tous entendus à la lecture :

- Liaison d'expression (bouton arc, touche S) : notes différentes jouées liées, sans coup de langue. À l'écoute, les notes s'enchaînent sans nouvelle attaque.
- Liaison de phrasé (bouton au grand arc au-dessus de trois notes, touche P) : grand arc au-dessus d'un groupe de notes à jouer d'un seul souffle. À l'écoute, il n'y a aucune coupure dans le groupe.
- Respiration (bouton virgule, touche ,) : virgule après la note sélectionnée. À l'écoute, une vraie petite coupure.
- Trille (bouton tr, Maj+T) : signe tr au-dessus de la note sélectionnée (ou de toutes les notes d'une plage). À l'écoute, c'est un trille à l'ancienne : il commence sur la note du dessus dans la gamme, alterne rapidement avec la note écrite, et finit sur elle. Refaire la commande retire le trille.

Pour poser une liaison :

- Sur des notes déjà écrites : sélectionnez-les (clic sur la première, Maj+clic sur la dernière), puis S ou P. Refaire la même commande sur la même plage retire la liaison.
- Pendant l'écriture : après la première note, appuyez sur S (ou P). Le bouton reste allumé. Écrivez la suite, puis rappuyez pour terminer (ou Échap).
- Sur une seule note sélectionnée : en mode Sélection, la liaison va jusqu'à la note suivante. Si la note porte déjà une liaison, la commande la retire.

Les liaisons, respirations et trilles sont conservés dans les fichiers Partoch et en MusicXML. Le phrasé est retrouvé à l'import : une liaison qui en contient d'autres est lue comme une liaison de phrasé.

Nuances, articulations, ornements
---------------------------------

Tout s'applique à la note sélectionnée, ou à toutes les notes d'une plage, et s'entend à la lecture. Refaire la même commande retire le signe.

- Nuances : pp à ff, sfz, fp, posées sous la première note. Crescendo (<) et Decrescendo (>) : de la première à la dernière note sélectionnée (ou jusqu'à la note suivante).
- Articulations : staccato (Maj+S), staccatissimo, tenuto (Maj+N), accent (Maj+V), marcato (Maj+O), point d'orgue (Maj+H).
- Ornements : trille (Maj+T), mordant, mordant supérieur, gruppetto.

Reprises et tempo
-----------------

- Reprises et sauts : sélectionnez la ou les mesures, puis début / fin de reprise, 1re et 2e fois, segno, coda, à la Coda, Fine, D.C., D.S. (al Fine, al Coda). La lecture suit les reprises et les sauts. Le même menu pose un saut de ligne ou un saut de page après la mesure.
- Tempo : indication ♩ = … (Alt+T), rit., accel., a tempo, entendus à la lecture. Un rit. ou un accel. dure jusqu'à l'indication suivante, deux mesures au plus.

Paroles, accords, basse chiffrée
--------------------------------

Sélectionnez la première note, puis Paroles (Ctrl+L), Accords (Ctrl+K) ou Basse chiffrée (Ctrl+G) dans le menu Texte, et tapez :

- Espace passe à la note suivante (Maj+Espace revient en arrière) ;
- pour les paroles, - coupe le mot et passe à la note suivante ; ↓ / ↑ changent de couplet ;
- pour la basse chiffrée, / empile les chiffres (6/4) ;
- Entrée termine, Échap annule la saisie en cours. Effacer le texte supprime la syllabe ou l'accord.

Les nuances, articulations, ornements, reprises, sauts, tempos, paroles, accords et chiffrages sont conservés dans les fichiers Partoch, imprimés, mis dans le PDF, et exportés en MusicXML (MuseScore les retrouve). À l'inverse, ceux d'un fichier MusicXML venu de MuseScore ou d'une partition scannée sont repris à l'import.

Textes libres
-------------

Pour écrire une indication n'importe où (« doux », « respirer ici », un doigté…) : bouton T (ou Ctrl+T), puis clic sur la partition à l'endroit voulu, et tapez. Entrée valide, Maj+Entrée passe à la ligne, Échap annule.

- Déplacer : glissez le texte avec la souris.
- Modifier : double-clic sur le texte (ou Entrée quand il est sélectionné).
- Supprimer : clic droit sur le texte (ou Suppr quand il est sélectionné).

Le texte est accroché à la note la plus proche : il suit la musique si la mise en page change ou si vous ajoutez des mesures avant. Il est imprimé, mis dans le PDF et conservé en MusicXML (les indications écrites des fichiers MusicXML sont aussi reprises à l'import).

Accords
-------

Pour écrire plusieurs notes au même endroit (en écriture) : activez le bouton Accord (à droite de la petite note), puis cliquez sur une note déjà écrite, à la hauteur voulue — la note s'ajoute à l'accord. Recliquer sur une note de l'accord la retire. Sans le bouton, Maj + clic fait la même chose. Sur une portée de flûte, Partoch joue toutes les notes de l'accord.

Une partition d'essai qui réunit toutes les fonctions est dans Partitions\Partition test.musicxml (Ouvrir → choisir ce fichier).

Triolets, petites notes, voix, levée et métrique
------------------------------------------------

- Triolets (bouton crochet « 3 », Ctrl+3) :
  - en écriture, activez le bouton : les notes écrites forment des triolets de la durée choisie (trois croches à la place de deux) ;
  - sur une note sélectionnée, le bouton la divise en triolet. Sur une note de triolet, il retire le triolet.
  - Les autres n-olets (quintolets, duolets…) sont repris tels quels à l'import MusicXML.
- Petites notes (bouton petite note barrée) :
  - sur une note sélectionnée, le bouton ajoute une petite note conjointe au-dessus, ou retire les petites notes de cette note ;
  - en écriture, activez le bouton, puis cliquez sur une note déjà écrite, à la hauteur voulue. Chaque clic ajoute une petite note.
  - À la lecture, une petite note barrée est très brève ; une appoggiature non barrée prend un peu plus de temps sur la note.
- Voix (boutons 1 / 2 de la barre d'écriture) :
  - la voix 2 s'écrit par-dessus la voix 1 sur la même portée, hampes vers le bas ;
  - en écriture, choisissez la voix avant d'écrire ;
  - sur une note sélectionnée, le bouton la déplace dans cette voix.
  - Un clic sur une note sélectionne la bonne voix toute seule.
- Levée (anacrouse) : réglée dans Partition… (aucune, 1 temps, 2 temps…). La levée n'est pas numérotée : la mesure 1 est la première mesure complète.
- Métrique : sélectionnez la mesure où la métrique change, puis bouton Métrique et un clic sur la métrique voulue (2/4, 3/4, 4/4, 6/8…) : c'est appliqué tout de suite à partir de cette mesure. Plus rapide encore : cliquez directement sur un chiffrage dans la partition. Autre métrique… pour les cas rares (11/8…).

Enregistrer au micro (transcription)
------------------------------------

Jouez à la flûte (ou chantez) avec le métronome : Partoch écrit les notes dans la portée choisie.

1. Sélectionnez la mesure de départ (ou rien : début de la partition), puis bouton Micro (en haut à droite).
2. Choisissez la portée, la mesure de départ, le tempo (plus lent = plus facile ; la partition garde son tempo) et la précision du rythme (double croche ou croche). Le vumètre montre si le micro vous entend bien : visez le vert, sans aller dans le rouge.
3. ● Enregistrer : une mesure de décompte, puis jouez. Espace, Échap ou R pour arrêter.
4. Les notes apparaissent, sélectionnées. Elles remplacent ce qu'il y avait sur cette portée, de la mesure de départ jusqu'à la mesure où vous avez arrêté. Ctrl+Z annule.

Ensuite, la touche R relance directement un enregistrement avec les mêmes réglages, à partir de la mesure sélectionnée.

Conseils :
- Détachez les notes avec la langue (« tu », « du ») : c'est ainsi que Partoch sépare deux notes identiques qui se suivent. Les notes liées (sans coup de langue) sont reconnues grâce au changement de hauteur.
- Sur une portée de flûte soprano ou basse, jouez normalement : Partoch tient compte de l'octave de différence entre le son et l'écriture. Si l'octave tombe à côté de la tessiture, elle est corrigée automatiquement (désactivable dans Réglages avancés).
- Si les notes arrivent systématiquement un peu trop tard (ou trop tôt) dans la mesure, réglez Retard dans Réglages avancés, puis Retranscrire la dernière prise : inutile de rejouer.
- Jouer les autres portées fait entendre l'accompagnement pendant que vous jouez : à utiliser avec un casque, sinon le micro entend aussi l'accompagnement.
- Le micro doit être autorisé pour les applications de bureau (Windows : Paramètres → Confidentialité → Microphone).

Importer un enregistrement audio
--------------------------------

Ouvrir accepte aussi les enregistrements (.mp3, .wav, .m4a, .ogg, .flac…) : Partoch écoute le morceau et en écrit la partition, même s'il y a plusieurs flûtes ou un piano.

1. L'analyse se fait entièrement sur l'ordinateur (rien n'est envoyé sur Internet). Elle prend environ un tiers de la durée de l'enregistrement.
2. Une fenêtre montre ce qui a été trouvé : nombre de notes, voix, tonalité, métrique, tempo, levée. Tout se règle avant d'importer, et la partition se met à jour à chaque changement :
   - Métrique et Tempo (avec ×2 et ÷2 si les mesures tombent mal) ;
   - Voix : automatique, ou de 1 à 4 ;
   - Rythme : à la double croche, ou à la croche (plus simple à lire) ;
   - Sensibilité : moins de notes pour un enregistrement bruyant, plus de notes pour un jeu rapide ou doux ;
   - Transposition : Partoch propose la tonalité où les flûtes jouent le plus de notes dans leur tessiture ;
   - Instruments : pour chaque voix, la flûte la plus adaptée est choisie d'après la hauteur des notes. Vous pouvez en choisir une autre ; le pourcentage de notes jouables est affiché.
3. Importer crée la partition, qui reste modifiable comme les autres (Ctrl+Z, Partition…).

Ça marche le mieux avec un enregistrement propre et peu de réverbération. La reconnaissance utilise Basic Pitch (Spotify, licence Apache 2.0).

Scanner une partition
---------------------

Fichier → Scanner une partition… numérise une partition imprimée et la transforme en partition Partoch, modifiable et jouable.

1. Choisissez le scanner (Partoch trouve tout seul ceux que Windows connaît) et la qualité : 300 ppp convient presque toujours, 400 ppp pour les petits caractères.
2. Posez la page sur la vitre, face vers le bas, puis Numériser la page (environ 30 secondes). Pour plusieurs pages, numérisez-les une à une dans l'ordre : elles formeront une seule partition. La croix sur une vignette retire une page ratée.
3. Lire la partition : la reconnaissance prend une dizaine de secondes par page, sur l'ordinateur.

Vous pouvez aussi ouvrir une photo ou un PDF de partition avec Ouvrir (ou en le glissant sur la fenêtre) : .pdf, .png, .jpg, .tif, .bmp.

À savoir :

- Les portées sans nom d'instrument reçoivent la flûte dont la tessiture correspond aux notes (changeable dans Partition…).
- La reconnaissance marche bien sur une partition imprimée, propre et droite. Elle peut se tromper sur une page penchée, floue ou abîmée, et ne lit pas les partitions écrites à la main. Écoutez toujours le résultat et comparez-le à l'original.
- Le titre et les paroles ne sont pas lus : seule la musique l'est. La fenêtre qui suit la lecture permet de corriger le titre, le compositeur et l'instrument de chaque partie.
- La lecture utilise Audiveris (logiciel libre, licence AGPL), à installer à part depuis https://github.com/Audiveris/audiveris/releases (fichier …windows-x86_64.msi). Sans lui, Partoch propose d'ouvrir cette page.
- Les pages numérisées restent sur l'ordinateur et sont effacées quand vous quittez Partoch.

Sélection
---------

- Clic sur une note : la sélectionne et la joue.
- Glisser la note vers le haut ou le bas : change sa hauteur.
- Clic dans le vide d'une mesure : sélectionne la mesure entière. Maj + clic étend la sélection.
- Avec une note sélectionnée, cliquer une durée de la palette change la durée de cette note.
- Ctrl+C / Ctrl+X / Ctrl+V : copier, couper, coller. Ctrl+A : tout sélectionner.
- Ctrl+Z / Ctrl+Y : annuler et rétablir.

S'entraîner
-----------

- Espace : lecture ou pause. La lecture part de la note sélectionnée (même en boucle : elle repart ensuite au début de la boucle).
- Vitesse : de 25 à 200 %, sans modifier le tempo écrit.
- À côté du bouton de lecture : Boucle (sur la sélection, sinon tout le morceau), Métronome, Décompte (une mesure avant de commencer) et Pistes (les curseurs) : décochez une portée pour la couper et jouer votre partie par-dessus.

Ouvrir, importer et exporter
----------------------------

- Ouvrir (Ctrl+O) accepte les fichiers .partoch, MusicXML (.musicxml, .xml, .mxl compressé), MIDI (.mid), les enregistrements audio et les partitions scannées (PDF, images). Vous pouvez aussi glisser un fichier sur la fenêtre.
- Pour récupérer une partition de MuseScore, exportez-la en MusicXML depuis MuseScore, puis ouvrez-la ici.
- À l'import MusicXML, Partoch reprend la levée, les changements de métrique, les triolets et n-olets, les petites notes, jusqu'à quatre voix par portée, les nuances et soufflets, articulations, ornements, reprises et voltas, sauts (D.C., D.S., Fine, Coda), tempos, paroles, accords et basse chiffrée. Les indications écrites comme « D.C. al Fine », « rall. » ou « a tempo » sont reconnues ; le format portrait ou paysage aussi. Si quelque chose doit être adapté (clé d'ut, plus de deux portées pour un instrument…), une fenêtre le signale.
- Pour le MIDI, le rythme est arrondi à la double croche, et l'instrument (flûte soprano, alto, ténor, basse ou piano) est deviné d'après la tessiture. La levée et les changements de métrique sont repris. Les trilles écrits note à note (alternance rapide de deux notes voisines) sont remplacés par une seule note avec le signe tr. Beaucoup de fichiers MIDI raccourcissent chaque note pour imiter le détaché (une noire jouée comme une croche pointée) : Partoch le détecte et rend aux notes leur valeur écrite. Pour le piano, chaque note va dans la main qui convient à sa hauteur.
- Les fichiers MIDI joués en direct (au clavier, à la guitare MIDI : notes qui ne tombent pas sur une grille) sont reconnus : Partoch retrouve la pulsation, la métrique (3 ou 4 temps) et le tempo, comme pour un enregistrement audio. Les fins de morceau très ralenties restent approximatives. Quand le fichier ne donne pas l'armure, elle est déduite des notes.
- Fichier → Exporter :
  - PDF (Ctrl+E) : format A4, les systèmes ne sont jamais coupés entre deux pages ;
  - Parties séparées (PDF) : un PDF par instrument dans le dossier choisi, avec les mesures de silence regroupées (silences multi-mesures) ;
  - Imprimer (Ctrl+P) ;
  - MusicXML, pour MuseScore et les autres logiciels ;
  - MIDI.

Divers
------

- Partition (en haut à droite) : titre, instruments (y compris un ensemble de flûtes), tonalité, métrique de départ, levée, tempo, son de flûte (MusyngKite ou FluidR3).
- Transposer : toute la partition ou seulement la sélection.
- Fichier → Mise en page… : A4 portrait ou paysage, taille des notes, nombre de mesures par ligne. Les sauts de ligne et de page se posent depuis le menu des reprises.
- Édition : doubler ou diviser par deux les durées de la sélection, répéter la sélection plusieurs fois à la suite, aller à une mesure (Ctrl+F).
- Ctrl + molette : zoom. F12 : outils de développement.

Sons : échantillons « recorder » de FluidR3 et MusyngKite (gleitz/midi-js-soundfonts). Gravure : VexFlow.

Licence : domaine public (Unlicense, voir LICENSE), chacun en fait ce qu'il veut. VexFlow (MIT), Basic Pitch (Apache 2.0), FluidR3 (CC BY 3.0), MusyngKite (CC BY-SA 3.0) et Audiveris (AGPL) gardent leur licence.
