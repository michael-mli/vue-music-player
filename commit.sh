if [ "$1" = "" ];then
	msg=update
else
	msg=$1
fi
git add --all
git commit -m $msg 
git push
