-- `prisma migrate dev` creates a temporary shadow database, so the app user needs
-- privileges beyond MYSQL_DATABASE. Local development only.
GRANT ALL PRIVILEGES ON *.* TO 'sigma'@'%';
FLUSH PRIVILEGES;
