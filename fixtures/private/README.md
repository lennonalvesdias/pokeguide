# Fixtures privadas

Saves reais contêm nome e ID do treinador, então nada aqui é versionado (veja `.gitignore`).

Para rodar os testes contra o seu save, coloque o arquivo exportado pelo Delta
(menu do jogo → Manage Save File → Export) em:

```
fixtures/private/firered.sav
```

Os testes da suíte "save real" são pulados automaticamente quando o arquivo não existe,
inclusive no CI.
