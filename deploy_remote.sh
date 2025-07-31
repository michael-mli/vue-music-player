cd dist 
zip -r MicsMusic.zip *
scp MicsMusic.zip $1:/var/www/html/others/music/.
ssh $1 "cd /var/www/html/others/music; unzip -o MicsMusic.zip "
