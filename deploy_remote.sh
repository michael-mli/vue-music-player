if [ $# -eq 0 ];then
 server=mc3.micsapp.com
else
 server=$1
cd dist 
zip -r MicsMusic.zip *
scp MicsMusic.zip ${server}:/var/www/html/others/music/.
ssh $server "cd /var/www/html/others/music; unzip -o MicsMusic.zip "
